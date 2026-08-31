use crate::{activity::load_activity, config::AppConfig};
use chrono::{Datelike, Duration, Local, TimeZone};
use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct NoteTotal {
    pub name: String,
    pub duration_ms: u64,
    pub count: usize,
}

#[derive(Clone, Debug, Default)]
pub struct StatsSnapshot {
    pub total_ms: u64,
    pub today_ms: u64,
    pub week_ms: u64,
    pub month_ms: u64,
    pub count: usize,
    pub average_ms: u64,
    pub longest_ms: u64,
    pub goal_progress: f32,
    pub top_notes: Vec<NoteTotal>,
}

pub fn snapshot(config: &AppConfig) -> StatsSnapshot {
    let entries = load_activity(config);
    let now = Local::now();
    let today = now.date_naive();
    let week_start = today - Duration::days(i64::from(now.weekday().num_days_from_monday()));
    let month_start = today.with_day(1).unwrap_or(today);
    let mut result = StatsSnapshot::default();
    let mut notes: HashMap<String, NoteTotal> = HashMap::new();

    for entry in &entries {
        let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() else {
            continue;
        };
        let date = moment.date_naive();
        result.total_ms = result.total_ms.saturating_add(entry.duration_ms);
        result.longest_ms = result.longest_ms.max(entry.duration_ms);
        if date == today {
            result.today_ms = result.today_ms.saturating_add(entry.duration_ms);
        }
        if date >= week_start {
            result.week_ms = result.week_ms.saturating_add(entry.duration_ms);
        }
        if date >= month_start {
            result.month_ms = result.month_ms.saturating_add(entry.duration_ms);
        }
        let note = notes
            .entry(entry.note_name.clone())
            .or_insert_with(|| NoteTotal {
                name: entry.note_name.clone(),
                ..NoteTotal::default()
            });
        note.duration_ms = note.duration_ms.saturating_add(entry.duration_ms);
        note.count += 1;
    }

    result.count = entries.len();
    result.average_ms = if result.count == 0 {
        0
    } else {
        result.total_ms / result.count as u64
    };
    result.goal_progress = if config.daily_goal_ms == 0 {
        0.0
    } else {
        (result.today_ms as f32 / config.daily_goal_ms as f32).clamp(0.0, 1.0)
    };
    result.top_notes = notes.into_values().collect();
    result
        .top_notes
        .sort_by_key(|note| std::cmp::Reverse(note.duration_ms));
    result.top_notes.truncate(12);
    result
}
