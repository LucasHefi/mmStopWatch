use crate::{
    activity::{ActivityEntry, load_activity},
    config::AppConfig,
};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug, Default)]
pub struct NoteTotal {
    pub name: String,
    pub duration_ms: u64,
    pub count: usize,
}

#[derive(Clone, Debug)]
pub struct DayTotal {
    pub date: NaiveDate,
    pub duration_ms: u64,
    pub goal_progress: f32,
    pub goal_met: bool,
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
    pub streak_days: u32,
    pub consistency_percent: u32,
    pub weekly_delta_percent: i32,
    pub daily: Vec<DayTotal>,
    pub top_notes: Vec<NoteTotal>,
}

pub fn snapshot(config: &AppConfig) -> StatsSnapshot {
    let entries = load_activity(config);
    snapshot_from_entries(&entries, config.daily_goal_ms, Local::now())
}

fn snapshot_from_entries(
    entries: &[ActivityEntry],
    daily_goal_ms: u64,
    now: DateTime<Local>,
) -> StatsSnapshot {
    let today = now.date_naive();
    let week_start = today - Duration::days(i64::from(now.weekday().num_days_from_monday()));
    let month_start = today.with_day(1).unwrap_or(today);
    let mut result = StatsSnapshot::default();
    let mut notes: HashMap<String, NoteTotal> = HashMap::new();
    let mut days: BTreeMap<NaiveDate, u64> = BTreeMap::new();

    for entry in entries {
        let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() else {
            continue;
        };
        let date = moment.date_naive();
        days.entry(date)
            .and_modify(|total| *total = total.saturating_add(entry.duration_ms))
            .or_insert(entry.duration_ms);
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
    result.goal_progress = if daily_goal_ms == 0 {
        0.0
    } else {
        (result.today_ms as f32 / daily_goal_ms as f32).clamp(0.0, 1.0)
    };
    result.streak_days = streak(&days, today);
    result.consistency_percent = consistency(&days, today, daily_goal_ms, 7);
    result.weekly_delta_percent = weekly_delta(entries, now.timestamp_millis());
    result.daily = (0..31)
        .rev()
        .map(|days_ago| {
            let date = today - Duration::days(days_ago);
            let duration_ms = days.get(&date).copied().unwrap_or(0);
            DayTotal {
                date,
                duration_ms,
                goal_progress: if daily_goal_ms == 0 {
                    0.0
                } else {
                    (duration_ms as f32 / daily_goal_ms as f32).clamp(0.0, 1.0)
                },
                goal_met: daily_goal_ms > 0 && duration_ms >= daily_goal_ms,
            }
        })
        .collect();
    result.top_notes = notes.into_values().collect();
    result
        .top_notes
        .sort_by_key(|note| std::cmp::Reverse(note.duration_ms));
    result.top_notes.truncate(12);
    result
}

fn streak(days: &BTreeMap<NaiveDate, u64>, today: NaiveDate) -> u32 {
    let Some(&latest) = days.keys().next_back() else {
        return 0;
    };
    if latest < today - Duration::days(1) {
        return 0;
    }
    let mut cursor = latest;
    let mut count = 0;
    while days.contains_key(&cursor) {
        count += 1;
        cursor -= Duration::days(1);
    }
    count
}

fn consistency(
    days: &BTreeMap<NaiveDate, u64>,
    today: NaiveDate,
    daily_goal_ms: u64,
    period_days: u32,
) -> u32 {
    if daily_goal_ms == 0 || period_days == 0 {
        return 0;
    }
    let met = (0..period_days)
        .filter(|days_ago| {
            days.get(&(today - Duration::days(i64::from(*days_ago))))
                .is_some_and(|duration| *duration >= daily_goal_ms)
        })
        .count();
    ((met as f64 / f64::from(period_days)) * 100.0).round() as u32
}

fn weekly_delta(entries: &[ActivityEntry], now_ms: i64) -> i32 {
    const WEEK_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
    let this_week_start = now_ms.saturating_sub(WEEK_MS);
    let last_week_start = this_week_start.saturating_sub(WEEK_MS);
    let mut current = 0_u64;
    let mut previous = 0_u64;
    for entry in entries {
        if entry.timestamp >= this_week_start {
            current = current.saturating_add(entry.duration_ms);
        } else if entry.timestamp >= last_week_start {
            previous = previous.saturating_add(entry.duration_ms);
        }
    }
    if previous > 0 {
        (((current as f64 - previous as f64) / previous as f64) * 100.0).round() as i32
    } else if current > 0 {
        100
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_noon(date: NaiveDate) -> DateTime<Local> {
        Local
            .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
            .single()
            .expect("test noon must exist")
    }

    fn entry(date: NaiveDate, duration_ms: u64) -> ActivityEntry {
        let timestamp = local_noon(date).timestamp_millis();
        ActivityEntry {
            timestamp,
            duration_ms,
            note_path: "/vault/note.md".into(),
            note_name: "Note".into(),
            saved_at: timestamp,
            end_timestamp: timestamp.saturating_add(duration_ms as i64),
            operation_id: format!("{date}:{duration_ms}"),
        }
    }

    #[test]
    fn computes_streak_consistency_and_daily_history() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let now = local_noon(today);
        let entries = vec![
            entry(today, 60_000),
            entry(today - Duration::days(1), 90_000),
            entry(today - Duration::days(2), 30_000),
        ];
        let result = snapshot_from_entries(&entries, 60_000, now);
        assert_eq!(result.streak_days, 3);
        assert_eq!(result.consistency_percent, 29);
        assert_eq!(result.daily.len(), 31);
        assert!(result.daily.last().is_some_and(|day| day.goal_met));
    }

    #[test]
    fn zero_goal_is_not_reported_as_completed() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let result = snapshot_from_entries(&[entry(today, 60_000)], 0, local_noon(today));
        assert_eq!(result.goal_progress, 0.0);
        assert_eq!(result.consistency_percent, 0);
        assert!(result.daily.iter().all(|day| !day.goal_met));
    }

    #[test]
    fn stale_activity_has_no_current_streak() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let result = snapshot_from_entries(
            &[entry(today - Duration::days(3), 60_000)],
            60_000,
            local_noon(today),
        );
        assert_eq!(result.streak_days, 0);
    }
}
