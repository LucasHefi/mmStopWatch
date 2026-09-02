use crate::{
    AppWindow, NoteRow, TimerGridRow, TimerRow,
    config::{AppConfig, TimerCheckpoint, load_timer_checkpoints, save_timer_checkpoints},
    i18n,
    storage::{IndexMetrics, Note, NoteIndex, NoteScan, format_stopwatch, format_time},
    timer::NativeTimer,
};
use slint::{Model, SharedString, VecModel};
use std::{path::PathBuf, rc::Rc};

#[cfg(test)]
use slint::ModelRc;

pub const COLORS: [u32; 8] = [
    0x34d399, 0x38bdf8, 0xa78bfa, 0xfbbf24, 0xfb7185, 0x2dd4bf, 0x818cf8, 0xa3e635,
];

/// Keep the Slint model deliberately small. The complete lightweight note
/// index stays in Rust, while the sidebar receives rows in demand-driven
/// batches as the user scrolls.
pub const NOTE_PAGE_SIZE: usize = 48;

pub struct AppState {
    pub config: AppConfig,
    pub notes: Vec<Note>,
    pub visible_notes: Vec<usize>,
    pub loaded_note_count: usize,
    pub timers: Vec<NativeTimer>,
    pub note_model: Rc<VecModel<NoteRow>>,
    pub timer_model: Rc<VecModel<TimerRow>>,
    pub timer_grid_model: Rc<VecModel<TimerGridRow>>,
    pub search: String,
    pub scan_warnings: Vec<String>,
    pub note_index: NoteIndex,
    pub index_cache_hits: usize,
    pub index_metrics: IndexMetrics,
    pub index_revision: u64,
    pub scan_in_progress: bool,
    diagnostics: bool,
}

impl AppState {
    pub fn new(config: AppConfig, diagnostics: bool) -> Self {
        Self {
            config,
            notes: Vec::new(),
            visible_notes: Vec::new(),
            loaded_note_count: NOTE_PAGE_SIZE,
            timers: Vec::new(),
            note_model: Rc::new(VecModel::default()),
            timer_model: Rc::new(VecModel::default()),
            timer_grid_model: Rc::new(VecModel::default()),
            search: String::new(),
            scan_warnings: Vec::new(),
            note_index: NoteIndex::default(),
            index_cache_hits: 0,
            index_metrics: IndexMetrics::default(),
            index_revision: 0,
            scan_in_progress: false,
            diagnostics,
        }
    }

    pub fn reload(&mut self) -> Result<usize, String> {
        let root = self
            .config
            .vault_path
            .as_deref()
            .ok_or_else(|| "Nejdřív vyberte složku s poznámkami.".to_owned())?;
        let scan = self
            .note_index
            .scan(
                root,
                &self.config.frontmatter_key,
                &self.config.time_estimate_key,
                &self.config.stats_field_keys,
            )
            .map_err(|error| error.to_string())?;
        self.index_cache_hits = self.note_index.cache_hits();
        self.index_metrics = self.note_index.metrics();
        self.index_revision = self.note_index.revision();
        self.apply_note_scan(scan);
        Ok(self.notes.len())
    }

    pub fn apply_note_scan(&mut self, scan: NoteScan) {
        self.notes = scan.notes;
        self.scan_warnings = scan.warnings;
        self.apply_filter();
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
        self.loaded_note_count = NOTE_PAGE_SIZE.min(self.visible_notes.len());
        self.rebuild_note_rows();
    }

    pub fn load_more_notes(&mut self) -> bool {
        let previous = self.loaded_note_count;
        self.loaded_note_count = self
            .loaded_note_count
            .saturating_add(NOTE_PAGE_SIZE)
            .min(self.visible_notes.len());
        for position in previous..self.loaded_note_count {
            if let Some(row) = self.note_row(position) {
                self.note_model.push(row);
            }
        }
        self.loaded_note_count != previous
    }

    pub fn has_more_notes(&self) -> bool {
        self.loaded_note_count < self.visible_notes.len()
    }

    pub fn rebuild_note_rows(&self) {
        self.note_model.set_vec(
            (0..self.loaded_note_count)
                .filter_map(|position| self.note_row(position))
                .collect::<Vec<_>>(),
        );
    }

    fn note_row(&self, position: usize) -> Option<NoteRow> {
        let note = self.notes.get(*self.visible_notes.get(position)?)?;
        Some(NoteRow {
            name: note.name.clone().into(),
            path: note.path.to_string_lossy().into_owned().into(),
            relative_path: note.relative_path.clone().into(),
            duration: format_time(note.duration_ms).into(),
            // Preview remains in the Rust index and is fetched only on demand.
            preview: "".into(),
            tags: note
                .tags
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("  ")
                .into(),
            pinned: self
                .config
                .pinned_notes
                .iter()
                .any(|path| path == &note.path.to_string_lossy()),
            active: self
                .timers
                .iter()
                .any(|timer| timer.note_path == note.path.to_string_lossy()),
        })
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
        self.apply_timer_order();
    }

    /// Applies the stable note-path order shared with the React/Tauri version.
    /// Unknown timers stay at the end in their current order.
    pub fn apply_timer_order(&mut self) {
        let order = &self.config.timer_layout.order;
        self.timers.sort_by_key(|timer| {
            order
                .iter()
                .position(|path| path == &timer.note_path)
                .unwrap_or(usize::MAX)
        });
    }

    /// Persists the current active order without forgetting inactive notes that
    /// may be opened again later.
    pub fn remember_timer_order(&mut self) {
        let active = self
            .timers
            .iter()
            .map(|timer| timer.note_path.clone())
            .collect::<Vec<_>>();
        let mut order = active.clone();
        order.extend(
            self.config
                .timer_layout
                .order
                .iter()
                .filter(|path| !active.contains(path))
                .cloned(),
        );
        self.config.timer_layout.order = order;
    }

    pub fn move_timer(&mut self, index: usize, offset: isize) -> bool {
        let Some(target) = index.checked_add_signed(offset) else {
            return false;
        };
        if index >= self.timers.len() || target >= self.timers.len() {
            return false;
        }
        self.timers.swap(index, target);
        self.remember_timer_order();
        true
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

    pub fn layout_columns(&self) -> usize {
        self.config
            .timer_layout
            .mode
            .strip_prefix("grid-")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1)
            .clamp(1, 4)
    }
}

#[cfg(test)]
pub fn note_rows(state: &AppState) -> ModelRc<NoteRow> {
    ModelRc::from(state.note_model.clone())
}

pub fn timer_row(timer: &NativeTimer, language: &str) -> TimerRow {
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
            i18n::tr_ref(language, "noEstimate").into()
        } else if current >= estimate_ms {
            format!(
                "{} {}",
                i18n::tr_ref(language, "expired"),
                format_time(current - estimate_ms)
            )
            .into()
        } else {
            format!(
                "{} {}",
                i18n::tr_ref(language, "remaining"),
                format_time(estimate_ms - current)
            )
            .into()
        },
        expired: estimate_minutes > 0 && current >= estimate_ms,
    }
}

pub fn refresh_note_model(ui: &AppWindow, state: &AppState) {
    ui.set_note_count(state.notes.len() as i32);
    ui.set_notes_loaded(state.loaded_note_count.min(state.visible_notes.len()) as i32);
    ui.set_filtered_note_count(state.visible_notes.len() as i32);
    ui.set_has_more_notes(state.has_more_notes());
}

pub fn refresh_models(ui: &AppWindow, state: &AppState) {
    state.rebuild_note_rows();
    refresh_note_model(ui, state);
    state.timer_model.set_vec(
        state
            .timers
            .iter()
            .map(|timer| timer_row(timer, &state.config.language))
            .collect::<Vec<_>>(),
    );
    sync_grid_model(state);
    ui.set_timer_count(state.timers.len() as i32);
    ui.set_scan_warning(if state.scan_warnings.is_empty() {
        "".into()
    } else {
        format!(
            "⚠ {} souborů nebo polí vyžaduje kontrolu: {}",
            state.scan_warnings.len(),
            state.scan_warnings[0]
        )
        .into()
    });
    ui.set_total_duration(
        format_time(state.notes.iter().map(|note| note.duration_ms).sum()).into(),
    );
}

pub fn sync_grid_model(state: &AppState) {
    let columns = state.layout_columns();
    if columns == 1 {
        state.timer_grid_model.set_vec(Vec::new());
        return;
    }
    let mut rows = Vec::with_capacity(state.timers.len().div_ceil(columns));
    for start in (0..state.timers.len()).step_by(columns) {
        rows.push(grid_row(state, start, columns));
    }
    state.timer_grid_model.set_vec(rows);
}

pub fn refresh_grid_row(state: &AppState, timer_index: usize) {
    let columns = state.layout_columns();
    if columns == 1 {
        return;
    }
    let model_index = timer_index / columns;
    let start = model_index * columns;
    state
        .timer_grid_model
        .set_row_data(model_index, grid_row(state, start, columns));
}

fn grid_row(state: &AppState, start: usize, columns: usize) -> TimerGridRow {
    let row = |offset: usize| {
        if offset >= columns {
            return TimerRow::default();
        }
        state
            .timers
            .get(start + offset)
            .map(|timer| timer_row(timer, &state.config.language))
            .unwrap_or_default()
    };
    TimerGridRow {
        a: row(0),
        b: row(1),
        c: row(2),
        d: row(3),
        has_a: state.timers.get(start).is_some(),
        has_b: columns > 1 && state.timers.get(start + 1).is_some(),
        has_c: columns > 2 && state.timers.get(start + 2).is_some(),
        has_d: columns > 3 && state.timers.get(start + 3).is_some(),
    }
}

pub fn set_status(ui: &AppWindow, message: impl Into<SharedString>, error: bool) {
    ui.set_status_message(message.into());
    ui.set_status_error(error);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timer(path: &str) -> NativeTimer {
        NativeTimer::new(
            path.into(),
            path.into(),
            0,
            None,
            slint::Color::from_rgb_u8(255, 255, 255),
        )
    }

    #[test]
    fn applies_and_updates_persisted_timer_order() {
        let mut state = AppState::new(AppConfig::default(), true);
        state.config.timer_layout.order = vec!["b.md".into(), "a.md".into()];
        state.timers = vec![timer("a.md"), timer("new.md"), timer("b.md")];

        state.apply_timer_order();
        assert_eq!(
            state
                .timers
                .iter()
                .map(|timer| timer.note_path.as_str())
                .collect::<Vec<_>>(),
            ["b.md", "a.md", "new.md"]
        );

        assert!(state.move_timer(1, -1));
        assert_eq!(
            state.config.timer_layout.order[..3],
            ["a.md", "b.md", "new.md"]
        );
        assert!(!state.move_timer(0, -1));
    }

    #[test]
    fn large_note_lists_are_exposed_to_the_ui_in_bounded_pages() {
        let mut state = AppState::new(AppConfig::default(), true);
        state.notes = (0..50_000)
            .map(|index| Note {
                path: PathBuf::from(format!("note-{index:05}.md")),
                name: format!("Note {index:05}"),
                relative_path: format!("folder/note-{index:05}.md"),
                duration_ms: 0,
                preview: "Preview stays in the Rust index".into(),
                tags: vec!["test".into()],
                time_estimate_minutes: None,
                fields: std::collections::HashMap::new(),
            })
            .collect();
        state.apply_filter();

        assert_eq!(state.loaded_note_count, NOTE_PAGE_SIZE);
        assert_eq!(state.visible_notes.len(), 50_000);
        let model = note_rows(&state);
        assert_eq!(model.row_count(), NOTE_PAGE_SIZE);
        assert!(state.has_more_notes());
        assert!(state.load_more_notes());
        assert_eq!(model.row_count(), NOTE_PAGE_SIZE * 2);
        assert!(state.load_more_notes());
        assert_eq!(model.row_count(), NOTE_PAGE_SIZE * 3);
        assert!(state.has_more_notes());
    }
}
