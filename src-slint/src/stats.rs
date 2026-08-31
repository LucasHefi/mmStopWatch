use crate::{
    activity::{ActivityEntry, load_activity},
    config::AppConfig,
    storage::Note,
};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Timelike};
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

#[derive(Clone, Debug)]
pub struct CalendarDay {
    pub date: NaiveDate,
    pub duration_ms: u64,
    pub goal_progress: f32,
    pub goal_met: bool,
    pub in_month: bool,
    pub today: bool,
}

#[derive(Clone, Debug)]
pub struct CalendarSnapshot {
    pub month: String,
    pub days: Vec<CalendarDay>,
}

#[derive(Clone, Debug)]
pub struct TrendTotal {
    pub label: String,
    pub duration_ms: u64,
    pub progress: f32,
}

#[derive(Clone, Debug, Default)]
pub struct BreakdownTotal {
    pub field: String,
    pub value: String,
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
    pub streak_days: u32,
    pub consistency_percent: u32,
    pub weekly_delta_percent: i32,
    pub daily: Vec<DayTotal>,
    pub calendar_month: String,
    pub calendar: Vec<CalendarDay>,
    pub weekdays: Vec<TrendTotal>,
    pub hours: Vec<TrendTotal>,
    pub best_weekday: String,
    pub peak_hour: String,
    pub weekday_average_ms: u64,
    pub weekend_average_ms: u64,
    pub night_percent: u32,
    pub productivity_slope_ms: i64,
    pub top_notes: Vec<NoteTotal>,
    pub breakdown: Vec<BreakdownTotal>,
}

pub fn snapshot(config: &AppConfig, notes: &[Note]) -> StatsSnapshot {
    let entries = load_activity(config);
    let mut snapshot = snapshot_from_entries(&entries, config.daily_goal_ms, Local::now());
    snapshot.breakdown = field_breakdown(&entries, notes, &config.stats_field_keys);
    snapshot
}

fn field_breakdown(
    entries: &[ActivityEntry],
    notes: &[Note],
    field_keys: &[String],
) -> Vec<BreakdownTotal> {
    let notes_by_path = notes
        .iter()
        .map(|note| (note.path.to_string_lossy().into_owned(), note))
        .collect::<HashMap<_, _>>();
    let mut totals: HashMap<(String, String), BreakdownTotal> = HashMap::new();
    for entry in entries {
        let Some(note) = notes_by_path.get(&entry.note_path) else {
            continue;
        };
        for field in field_keys {
            let Some(values) = note.fields.get(field) else {
                continue;
            };
            for value in values {
                let total = totals
                    .entry((field.clone(), value.clone()))
                    .or_insert_with(|| BreakdownTotal {
                        field: field.clone(),
                        value: value.clone(),
                        ..BreakdownTotal::default()
                    });
                total.duration_ms = total.duration_ms.saturating_add(entry.duration_ms);
                total.count += 1;
            }
        }
    }
    let mut result = totals.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| {
        left.field.cmp(&right.field).then_with(|| {
            right
                .duration_ms
                .cmp(&left.duration_ms)
                .then_with(|| left.value.cmp(&right.value))
        })
    });
    result
}

pub fn calendar_snapshot(config: &AppConfig, month_offset: i32) -> CalendarSnapshot {
    let entries = load_activity(config);
    let today = Local::now().date_naive();
    let viewed_month = shifted_month(today, month_offset);
    let days = entries
        .iter()
        .filter_map(|entry| {
            Local
                .timestamp_millis_opt(entry.timestamp)
                .single()
                .map(|moment| (moment.date_naive(), entry.duration_ms))
        })
        .fold(BTreeMap::new(), |mut totals, (date, duration)| {
            totals
                .entry(date)
                .and_modify(|total: &mut u64| *total = total.saturating_add(duration))
                .or_insert(duration);
            totals
        });
    let (month, days) = calendar_month(&days, viewed_month, today, config.daily_goal_ms);
    CalendarSnapshot { month, days }
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
    (result.calendar_month, result.calendar) = calendar_month(&days, today, today, daily_goal_ms);
    result.weekdays = weekday_distribution(entries);
    result.hours = hourly_distribution(entries);
    (
        result.best_weekday,
        result.peak_hour,
        result.weekday_average_ms,
        result.weekend_average_ms,
        result.night_percent,
        result.productivity_slope_ms,
    ) = insight_summary(entries, &days, today);
    result.top_notes = notes.into_values().collect();
    result
        .top_notes
        .sort_by_key(|note| std::cmp::Reverse(note.duration_ms));
    result.top_notes.truncate(12);
    result
}

fn normalized_totals(labels: impl IntoIterator<Item = String>, totals: &[u64]) -> Vec<TrendTotal> {
    let maximum = totals.iter().copied().max().unwrap_or(0);
    labels
        .into_iter()
        .zip(totals.iter().copied())
        .map(|(label, duration_ms)| TrendTotal {
            label,
            duration_ms,
            progress: if maximum == 0 {
                0.0
            } else {
                duration_ms as f32 / maximum as f32
            },
        })
        .collect()
}

fn weekday_distribution(entries: &[ActivityEntry]) -> Vec<TrendTotal> {
    let mut totals = [0_u64; 7];
    for entry in entries {
        if let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() {
            let index = moment.weekday().num_days_from_monday() as usize;
            totals[index] = totals[index].saturating_add(entry.duration_ms);
        }
    }
    normalized_totals(
        ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map(str::to_owned),
        &totals,
    )
}

fn hourly_distribution(entries: &[ActivityEntry]) -> Vec<TrendTotal> {
    let mut totals = [0_u64; 24];
    for entry in entries {
        if let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() {
            let index = moment.hour() as usize;
            totals[index] = totals[index].saturating_add(entry.duration_ms);
        }
    }
    normalized_totals((0..24).map(|hour| format!("{hour:02}:00")), &totals)
}

fn insight_summary(
    entries: &[ActivityEntry],
    days: &BTreeMap<NaiveDate, u64>,
    today: NaiveDate,
) -> (String, String, u64, u64, u32, i64) {
    let labels = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
    let mut weekday_totals = [0_u64; 7];
    let mut weekday_counts = [0_u64; 7];
    let mut hour_totals = [0_u64; 24];
    let mut working_ms = 0_u64;
    let mut working_count = 0_u64;
    let mut weekend_ms = 0_u64;
    let mut weekend_count = 0_u64;
    let mut total_ms = 0_u64;
    let mut night_ms = 0_u64;

    for entry in entries {
        let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() else {
            continue;
        };
        let weekday = moment.weekday().num_days_from_monday() as usize;
        let hour = moment.hour() as usize;
        weekday_totals[weekday] = weekday_totals[weekday].saturating_add(entry.duration_ms);
        weekday_counts[weekday] = weekday_counts[weekday].saturating_add(1);
        hour_totals[hour] = hour_totals[hour].saturating_add(entry.duration_ms);
        total_ms = total_ms.saturating_add(entry.duration_ms);
        if !(6..22).contains(&hour) {
            night_ms = night_ms.saturating_add(entry.duration_ms);
        }
        if weekday >= 5 {
            weekend_ms = weekend_ms.saturating_add(entry.duration_ms);
            weekend_count = weekend_count.saturating_add(1);
        } else {
            working_ms = working_ms.saturating_add(entry.duration_ms);
            working_count = working_count.saturating_add(1);
        }
    }

    let best_weekday = (0..7)
        .max_by_key(|index| {
            weekday_totals[*index]
                .checked_div(weekday_counts[*index])
                .unwrap_or(0)
        })
        .filter(|index| weekday_counts[*index] > 0)
        .map(|index| labels[index].to_owned())
        .unwrap_or_else(|| "—".into());
    let peak_hour = (0..24)
        .max_by_key(|hour| hour_totals[*hour])
        .filter(|hour| hour_totals[*hour] > 0)
        .map(|hour| format!("{hour:02}:00"))
        .unwrap_or_else(|| "—".into());
    let productivity_slope_ms = productivity_slope(days, today, 31);

    (
        best_weekday,
        peak_hour,
        working_ms.checked_div(working_count).unwrap_or(0),
        weekend_ms.checked_div(weekend_count).unwrap_or(0),
        if total_ms == 0 {
            0
        } else {
            ((night_ms as f64 / total_ms as f64) * 100.0).round() as u32
        },
        productivity_slope_ms,
    )
}

fn productivity_slope(days: &BTreeMap<NaiveDate, u64>, today: NaiveDate, period_days: i64) -> i64 {
    if period_days < 2 {
        return 0;
    }
    let n = period_days as f64;
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut sum_xy = 0.0;
    let mut sum_x2 = 0.0;
    for index in 0..period_days {
        let x = index as f64;
        let date = today - Duration::days(period_days - 1 - index);
        let y = days.get(&date).copied().unwrap_or(0) as f64;
        sum_x += x;
        sum_y += y;
        sum_xy += x * y;
        sum_x2 += x * x;
    }
    let denominator = n * sum_x2 - sum_x * sum_x;
    if denominator == 0.0 {
        0
    } else {
        ((n * sum_xy - sum_x * sum_y) / denominator).round() as i64
    }
}

fn calendar_month(
    days: &BTreeMap<NaiveDate, u64>,
    viewed_month: NaiveDate,
    today: NaiveDate,
    daily_goal_ms: u64,
) -> (String, Vec<CalendarDay>) {
    let first = viewed_month.with_day(1).unwrap_or(viewed_month);
    let start = first - Duration::days(i64::from(first.weekday().num_days_from_monday()));
    let calendar = (0..42)
        .map(|offset| {
            let date = start + Duration::days(offset);
            let in_month =
                date.month() == viewed_month.month() && date.year() == viewed_month.year();
            let duration_ms = if in_month {
                days.get(&date).copied().unwrap_or(0)
            } else {
                0
            };
            CalendarDay {
                date,
                duration_ms,
                goal_progress: if daily_goal_ms == 0 {
                    0.0
                } else {
                    (duration_ms as f32 / daily_goal_ms as f32).clamp(0.0, 1.0)
                },
                goal_met: daily_goal_ms > 0 && duration_ms >= daily_goal_ms,
                in_month,
                today: date == today,
            }
        })
        .collect();
    (first.format("%m / %Y").to_string(), calendar)
}

fn shifted_month(date: NaiveDate, offset: i32) -> NaiveDate {
    let month_index = date
        .year()
        .saturating_mul(12)
        .saturating_add(date.month0() as i32)
        .saturating_add(offset);
    let year = month_index.div_euclid(12);
    let month = month_index.rem_euclid(12) as u32 + 1;
    NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(date)
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

    #[test]
    fn calendar_is_a_monday_first_six_week_grid() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let result = snapshot_from_entries(&[entry(today, 60_000)], 60_000, local_noon(today));
        assert_eq!(result.calendar.len(), 42);
        assert_eq!(result.calendar[0].date.weekday().num_days_from_monday(), 0);
        assert!(result.calendar.iter().any(|day| day.today && day.goal_met));
        assert!(
            result
                .calendar
                .iter()
                .filter(|day| !day.in_month)
                .all(|day| day.duration_ms == 0)
        );
    }

    #[test]
    fn calendar_can_move_across_year_boundary() {
        let today = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
        assert_eq!(
            shifted_month(today, -1),
            NaiveDate::from_ymd_opt(2025, 12, 1).unwrap()
        );
        assert_eq!(
            shifted_month(today, 12),
            NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()
        );
    }

    #[test]
    fn trend_distributions_have_stable_shapes_and_normalization() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let entries = vec![entry(today, 60_000), entry(today, 30_000)];
        let weekdays = weekday_distribution(&entries);
        let hours = hourly_distribution(&entries);
        assert_eq!(weekdays.len(), 7);
        assert_eq!(hours.len(), 24);
        assert_eq!(
            weekdays.iter().map(|row| row.duration_ms).sum::<u64>(),
            90_000
        );
        assert_eq!(hours.iter().map(|row| row.duration_ms).sum::<u64>(), 90_000);
        assert!(weekdays.iter().any(|row| row.progress == 1.0));
        assert!(hours.iter().any(|row| row.progress == 1.0));
    }

    #[test]
    fn insights_identify_peak_day_hour_and_night_share() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let result = snapshot_from_entries(&[entry(today, 90_000)], 60_000, local_noon(today));
        assert_eq!(result.best_weekday, "Po");
        assert_eq!(result.peak_hour, "12:00");
        assert_eq!(result.weekday_average_ms, 90_000);
        assert_eq!(result.weekend_average_ms, 0);
        assert_eq!(result.night_percent, 0);
    }

    #[test]
    fn breakdown_aggregates_configured_frontmatter_values() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let mut first = entry(today, 60_000);
        first.note_path = "/vault/note.md".into();
        let notes = vec![Note {
            path: std::path::PathBuf::from("/vault/note.md"),
            name: "Note".into(),
            relative_path: "note.md".into(),
            duration_ms: 60_000,
            preview: String::new(),
            tags: Vec::new(),
            time_estimate_minutes: None,
            fields: HashMap::from([("project".into(), vec!["alpha".into(), "beta".into()])]),
        }];

        let rows = field_breakdown(&[first], &notes, &["project".into()]);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row.duration_ms == 60_000));
        assert!(rows.iter().all(|row| row.count == 1));
    }
}
