mod config;
mod storage;
mod timer;

use config::{AppConfig, TimerCheckpoint, load_timer_checkpoints, save_timer_checkpoints};
use slint::{Model, ModelRc, SharedString, Timer, TimerMode, VecModel};
use std::{
    cell::RefCell,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};
use storage::{Note, format_stopwatch, format_time, scan_notes, write_total_duration};
use timer::NativeTimer;

slint::include_modules!();

const COLORS: [u32; 8] = [
    0x34d399, 0x38bdf8, 0xa78bfa, 0xfbbf24, 0xfb7185, 0x2dd4bf, 0x818cf8, 0xa3e635,
];

struct State {
    config: AppConfig,
    notes: Vec<Note>,
    visible_notes: Vec<usize>,
    timers: Vec<NativeTimer>,
    timer_model: Rc<VecModel<TimerRow>>,
    search: String,
    diagnostics: bool,
}

impl State {
    fn new(config: AppConfig, diagnostics: bool) -> Self {
        Self {
            config,
            notes: Vec::new(),
            visible_notes: Vec::new(),
            timers: Vec::new(),
            timer_model: Rc::new(VecModel::default()),
            search: String::new(),
            diagnostics,
        }
    }

    fn reload(&mut self) -> Result<usize, String> {
        let root = self
            .config
            .vault_path
            .as_deref()
            .ok_or_else(|| "Nejdřív vyberte složku s poznámkami.".to_owned())?;
        self.notes =
            scan_notes(root, &self.config.frontmatter_key).map_err(|error| error.to_string())?;
        self.apply_filter();
        Ok(self.notes.len())
    }

    fn apply_filter(&mut self) {
        let query = self.search.trim().to_lowercase();
        self.visible_notes = self
            .notes
            .iter()
            .enumerate()
            .filter(|(_, note)| {
                query.is_empty()
                    || note.name.to_lowercase().contains(&query)
                    || note.relative_path.to_lowercase().contains(&query)
                    || note.preview.to_lowercase().contains(&query)
            })
            .map(|(index, _)| index)
            .collect();
    }

    fn restore_timers(&mut self) {
        if self.diagnostics {
            return;
        }
        for checkpoint in load_timer_checkpoints() {
            let path = PathBuf::from(&checkpoint.note_path);
            if self
                .timers
                .iter()
                .any(|timer| timer.note_path == checkpoint.note_path)
                || !self.notes.iter().any(|note| note.path == path)
            {
                continue;
            }
            self.timers.push(NativeTimer::new(
                checkpoint.note_path,
                checkpoint.name,
                checkpoint.elapsed_ms,
                slint::Color::from_argb_encoded(checkpoint.color_argb),
            ));
        }
    }

    fn checkpoint_timers(&self) {
        if self.diagnostics {
            return;
        }
        let checkpoints = self
            .timers
            .iter()
            .map(|timer| TimerCheckpoint {
                note_path: timer.note_path.clone(),
                name: timer.name.clone(),
                elapsed_ms: timer.current_elapsed_ms(),
                color_argb: timer.color.as_argb_encoded(),
            })
            .collect::<Vec<_>>();
        if let Err(error) = save_timer_checkpoints(&checkpoints) {
            eprintln!("timer checkpoint failed: {error}");
        }
    }
}

fn note_rows(state: &State) -> ModelRc<NoteRow> {
    let rows = state
        .visible_notes
        .iter()
        .map(|index| {
            let note = &state.notes[*index];
            NoteRow {
                name: note.name.clone().into(),
                path: note.path.to_string_lossy().into_owned().into(),
                relative_path: note.relative_path.clone().into(),
                duration: format_time(note.duration_ms).into(),
                preview: note.preview.clone().into(),
                active: state
                    .timers
                    .iter()
                    .any(|timer| timer.note_path == note.path.to_string_lossy()),
            }
        })
        .collect::<Vec<_>>();
    ModelRc::new(VecModel::from(rows))
}

fn timer_row(timer: &NativeTimer) -> TimerRow {
    TimerRow {
        name: timer.name.clone().into(),
        elapsed: format_stopwatch(timer.current_elapsed_ms()).into(),
        running: timer.is_running(),
        color: timer.color,
    }
}

fn sync_timer_model(state: &State) {
    state
        .timer_model
        .set_vec(state.timers.iter().map(timer_row).collect::<Vec<_>>());
}

fn refresh_models(ui: &AppWindow, state: &State) {
    ui.set_notes(note_rows(state));
    sync_timer_model(state);
    ui.set_timer_count(state.timers.len() as i32);
}

fn set_status(ui: &AppWindow, message: impl Into<SharedString>, error: bool) {
    ui.set_status_message(message.into());
    ui.set_status_error(error);
}

fn write_snapshot(ui: &AppWindow, path: &Path) -> io::Result<()> {
    let pixels = ui.window().take_snapshot().map_err(io::Error::other)?;
    let mut output = fs::File::create(path)?;
    write!(
        output,
        "P7\nWIDTH {}\nHEIGHT {}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n",
        pixels.width(),
        pixels.height()
    )?;
    output.write_all(pixels.as_bytes())
}

fn main() -> Result<(), slint::PlatformError> {
    let mut config = AppConfig::load();
    if let Some(argument) = std::env::args_os().nth(1) {
        config.vault_path = Some(PathBuf::from(argument));
    }

    let ui = AppWindow::new()?;
    ui.set_vault_path(
        config
            .vault_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
            .into(),
    );
    let diagnostics = std::env::var_os("MMSTOPWATCH_PREVIEW_TIMER").is_some();
    let state = Rc::new(RefCell::new(State::new(config, diagnostics)));
    ui.set_timers(ModelRc::from(state.borrow().timer_model.clone()));

    if state.borrow().config.vault_path.is_some() {
        match state.borrow_mut().reload() {
            Ok(count) => set_status(&ui, format!("Načteno {count} poznámek"), false),
            Err(error) => set_status(&ui, error, true),
        }
    }
    state.borrow_mut().restore_timers();

    if std::env::var_os("MMSTOPWATCH_PREVIEW_TIMER").is_some() {
        let mut state = state.borrow_mut();
        if let Some(note) = state.notes.first() {
            let mut timer = NativeTimer::new(
                note.path.to_string_lossy().into_owned(),
                note.name.clone(),
                note.duration_ms,
                slint::Color::from_rgb_u8(52, 211, 153),
            );
            timer.toggle();
            state.timers.push(timer);
        }
    }
    refresh_models(&ui, &state.borrow());

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_choose_folder(move || {
            let Some(ui) = weak.upgrade() else { return };
            if !state.borrow().timers.is_empty() {
                set_status(
                    &ui,
                    "Před změnou složky nejdřív uložte nebo zahoďte otevřené časomíry.",
                    true,
                );
                return;
            }
            let Some(folder) = rfd::FileDialog::new()
                .set_title("Vyberte složku s Markdown poznámkami")
                .pick_folder()
            else {
                return;
            };
            {
                let mut state = state.borrow_mut();
                state.config.vault_path = Some(folder.clone());
                ui.set_vault_path(folder.to_string_lossy().into_owned().into());
                if let Err(error) = state.config.save() {
                    set_status(
                        &ui,
                        format!("Konfiguraci se nepodařilo uložit: {error}"),
                        true,
                    );
                }
                match state.reload() {
                    Ok(count) => set_status(&ui, format!("Načteno {count} poznámek"), false),
                    Err(error) => set_status(&ui, error, true),
                }
            }
            refresh_models(&ui, &state.borrow());
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_refresh(move || {
            let Some(ui) = weak.upgrade() else { return };
            match state.borrow_mut().reload() {
                Ok(count) => set_status(&ui, format!("Obnoveno {count} poznámek"), false),
                Err(error) => set_status(&ui, error, true),
            }
            refresh_models(&ui, &state.borrow());
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_search_changed(move |query| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            state.search = query.to_string();
            state.apply_filter();
            ui.set_notes(note_rows(&state));
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_add_timer(move |visible_index| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let Some(note_index) = state.visible_notes.get(visible_index as usize).copied() else {
                return;
            };
            let note_path = state.notes[note_index].path.to_string_lossy().into_owned();
            let note_name = state.notes[note_index].name.clone();
            let note_duration = state.notes[note_index].duration_ms;
            if state
                .timers
                .iter()
                .any(|timer| timer.note_path == note_path)
            {
                set_status(&ui, "Pro tuto poznámku už časomíra existuje.", true);
                return;
            }
            let rgb = COLORS[state.timers.len() % COLORS.len()];
            let color = slint::Color::from_rgb_u8((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8);
            state
                .timers
                .push(NativeTimer::new(note_path, note_name, note_duration, color));
            state.checkpoint_timers();
            set_status(&ui, "Časomíra je připravená.", false);
            refresh_models(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_timer(move |index| {
            let Some(_ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let row = state.timers.get_mut(index as usize).map(|timer| {
                timer.toggle();
                timer_row(timer)
            });
            if let Some(row) = row {
                state.timer_model.set_row_data(index as usize, row);
                state.checkpoint_timers();
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_discard_timer(move |index| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            if (index as usize) < state.timers.len() {
                state.timers.remove(index as usize);
                state.checkpoint_timers();
                set_status(&ui, "Časomíra byla zahozena bez změny poznámky.", false);
            }
            refresh_models(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_timer(move |index| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let (path, elapsed, name) = {
                let Some(timer) = state.timers.get_mut(index as usize) else {
                    return;
                };
                timer.pause();
                (
                    PathBuf::from(&timer.note_path),
                    timer.current_elapsed_ms(),
                    timer.name.clone(),
                )
            };
            let key = state.config.frontmatter_key.clone();
            match write_total_duration(&path, &key, elapsed) {
                Ok(()) => {
                    state.timers.remove(index as usize);
                    if let Some(note) = state.notes.iter_mut().find(|note| note.path == path) {
                        note.duration_ms = elapsed;
                    }
                    state.checkpoint_timers();
                    set_status(&ui, format!("Čas pro „{name}“ byl uložen."), false);
                    refresh_models(&ui, &state);
                }
                Err(error) => {
                    state.checkpoint_timers();
                    set_status(&ui, format!("Uložení selhalo: {error}"), true);
                }
            }
        });
    }

    let timer_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        timer_tick.start(TimerMode::Repeated, Duration::from_millis(50), move || {
            let Some(_ui) = weak.upgrade() else { return };
            let state = state.borrow();
            for (index, timer) in state.timers.iter().enumerate() {
                if timer.is_running() {
                    state.timer_model.set_row_data(index, timer_row(timer));
                }
            }
        });
    }

    let animation_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let mut phase = 0.0_f32;
        let mut active_frame = 0_u8;
        animation_tick.start(TimerMode::Repeated, Duration::from_millis(150), move || {
            let Some(ui) = weak.upgrade() else { return };
            if state.borrow().timers.iter().any(NativeTimer::is_running) {
                active_frame = (active_frame + 1) % 3;
                if active_frame != 0 {
                    return;
                }
            }
            phase = (phase + 0.012) % std::f32::consts::TAU;
            ui.set_glow_a_x(38.0 + phase.sin() * 18.0);
            ui.set_glow_a_y(18.0 + (phase * 0.7).cos() * 10.0);
            ui.set_glow_b_x(70.0 + (phase * 0.8).cos() * 14.0);
            ui.set_glow_b_y(70.0 + (phase * 0.55).sin() * 12.0);
        });
    }

    let recovery_tick = Timer::default();
    {
        let state = state.clone();
        recovery_tick.start(TimerMode::Repeated, Duration::from_secs(5), move || {
            let state = state.borrow();
            if state.timers.iter().any(NativeTimer::is_running) {
                state.checkpoint_timers();
            }
        });
    }

    if let Some(snapshot_path) = std::env::var_os("MMSTOPWATCH_SNAPSHOT") {
        let weak = ui.as_weak();
        Timer::single_shot(Duration::from_millis(500), move || {
            if let Some(ui) = weak.upgrade()
                && let Err(error) = write_snapshot(&ui, Path::new(&snapshot_path))
            {
                eprintln!("snapshot failed: {error}");
            }
            let _ = slint::quit_event_loop();
        });
    }

    ui.run()
}
