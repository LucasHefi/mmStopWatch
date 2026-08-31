use crate::{
    AppWindow, NoteRow, TimerRow,
    config::{AppConfig, TimerCheckpoint, load_timer_checkpoints, save_timer_checkpoints},
    storage::{Note, format_stopwatch, format_time, scan_notes},
    timer::NativeTimer,
};
use slint::{ModelRc, SharedString, VecModel};
use std::{path::PathBuf, rc::Rc};

pub const COLORS: [u32; 8] = [
    0x34d399, 0x38bdf8, 0xa78bfa, 0xfbbf24, 0xfb7185, 0x2dd4bf, 0x818cf8, 0xa3e635,
];

pub struct AppState {
    pub config: AppConfig,
    pub notes: Vec<Note>,
    pub visible_notes: Vec<usize>,
    pub timers: Vec<NativeTimer>,
    pub timer_model: Rc<VecModel<TimerRow>>,
    pub search: String,
    diagnostics: bool,
}

impl AppState {
    pub fn new(config: AppConfig, diagnostics: bool) -> Self {
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

    pub fn reload(&mut self) -> Result<usize, String> {
        let root = self
            .config
            .vault_path
            .as_deref()
            .ok_or_else(|| "Nejdřív vyberte složku s poznámkami.".to_owned())?;
        self.notes = scan_notes(
            root,
            &self.config.frontmatter_key,
            &self.config.time_estimate_key,
        )
        .map_err(|error| error.to_string())?;
        self.apply_filter();
        Ok(self.notes.len())
    }

    pub fn apply_filter(&mut self) {
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
        self.visible_notes.sort_by_key(|index| {
            let note = &self.notes[*index];
            (
                !self
                    .config
                    .pinned_notes
                    .iter()
                    .any(|path| path == &note.path.to_string_lossy()),
                note.name.to_lowercase(),
            )
        });
    }

    pub fn restore_timers(&mut self) {
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
            let mut timer = NativeTimer::new(
                checkpoint.note_path,
                checkpoint.name,
                checkpoint.elapsed_ms,
                checkpoint.time_estimate_minutes,
                slint::Color::from_argb_encoded(checkpoint.color_argb),
            );
            timer.base_elapsed_ms = if checkpoint.base_elapsed_ms == 0 {
                checkpoint.elapsed_ms
            } else {
                checkpoint.base_elapsed_ms
            };
            self.timers.push(timer);
        }
    }

    pub fn checkpoint_timers(&self) {
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
                base_elapsed_ms: timer.base_elapsed_ms,
                time_estimate_minutes: timer.time_estimate_minutes,
            })
            .collect::<Vec<_>>();
        if let Err(error) = save_timer_checkpoints(&checkpoints) {
            eprintln!("timer checkpoint failed: {error}");
        }
    }
}

pub fn note_rows(state: &AppState) -> ModelRc<NoteRow> {
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
                tags: note
                    .tags
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("  ")
                    .into(),
                pinned: state
                    .config
                    .pinned_notes
                    .iter()
                    .any(|path| path == &note.path.to_string_lossy()),
                active: state
                    .timers
                    .iter()
                    .any(|timer| timer.note_path == note.path.to_string_lossy()),
            }
        })
        .collect::<Vec<_>>();
    ModelRc::new(VecModel::from(rows))
}

pub fn timer_row(timer: &NativeTimer) -> TimerRow {
    let current = timer.current_elapsed_ms();
    let estimate_minutes = timer.time_estimate_minutes.unwrap_or(0);
    let estimate_ms = estimate_minutes.saturating_mul(60_000);
    TimerRow {
        name: timer.name.clone().into(),
        elapsed: format_stopwatch(current).into(),
        added: format!("+{}", format_time(timer.added_elapsed_ms())).into(),
        running: timer.is_running(),
        color: timer.color,
        estimate_minutes: estimate_minutes as i32,
        estimate_progress: timer.estimate_progress(),
        estimate_status: if estimate_minutes == 0 {
            "Bez odhadu".into()
        } else if current >= estimate_ms {
            format!("Překročeno o {}", format_time(current - estimate_ms)).into()
        } else {
            format!("Zbývá {}", format_time(estimate_ms - current)).into()
        },
        expired: estimate_minutes > 0 && current >= estimate_ms,
    }
}

pub fn refresh_models(ui: &AppWindow, state: &AppState) {
    ui.set_notes(note_rows(state));
    state
        .timer_model
        .set_vec(state.timers.iter().map(timer_row).collect::<Vec<_>>());
    ui.set_timer_count(state.timers.len() as i32);
    ui.set_note_count(state.notes.len() as i32);
    ui.set_total_duration(
        format_time(state.notes.iter().map(|note| note.duration_ms).sum()).into(),
    );
}

pub fn set_status(ui: &AppWindow, message: impl Into<SharedString>, error: bool) {
    ui.set_status_message(message.into());
    ui.set_status_error(error);
}
