use crate::{
    activity::{ActivityEntry, load_activity_range},
    config::AppConfig,
    storage::Note,
};
use chrono::{DateTime, Duration, Local, TimeZone};
use std::{
    collections::{BTreeMap, HashMap},
    fs, io,
    path::PathBuf,
};

pub fn save_report(config: &AppConfig, notes: &[Note], days: i64) -> io::Result<PathBuf> {
    let root = config
        .vault_path
        .as_ref()
        .ok_or_else(|| io::Error::other("není vybraný vault"))?;
    let now = Local::now();
    let since = (now - Duration::days(days)).timestamp_millis();
    let entries = load_activity_range(config, Some(since), None);
    let kind = if days <= 7 { "weekly" } else { "monthly" };
    let markdown = build_report(config, notes, &entries, days, now);

    let path = root.join(format!("mmST-{kind}-report-{}.md", now.format("%Y-%m-%d")));
    let temporary = path.with_extension("md.tmp");
    fs::write(&temporary, markdown)?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::copy(&temporary, &path)?;
        fs::remove_file(temporary)?;
        return Ok(path);
    }
    fs::rename(temporary, &path)?;
    Ok(path)
}

fn build_report(
    config: &AppConfig,
    notes: &[Note],
    entries: &[ActivityEntry],
    days: i64,
    now: DateTime<Local>,
) -> String {
    let label = if days <= 7 { "Weekly" } else { "Monthly" };
    let total_ms = entries.iter().map(|entry| entry.duration_ms).sum::<u64>();
    let average_ms = total_ms.checked_div(entries.len() as u64).unwrap_or(0);
    let mut note_totals: HashMap<String, (u64, usize)> = HashMap::new();
    let mut day_totals: BTreeMap<chrono::NaiveDate, u64> = BTreeMap::new();
    let note_by_path = notes
        .iter()
        .map(|note| (note.path.to_string_lossy().into_owned(), note))
        .collect::<HashMap<_, _>>();
    let mut tag_totals: HashMap<String, (u64, usize)> = HashMap::new();
    let mut estimated = 0_usize;
    let mut met_estimate = 0_usize;

    for entry in entries {
        let total = note_totals.entry(entry.note_name.clone()).or_default();
        total.0 = total.0.saturating_add(entry.duration_ms);
        total.1 += 1;
        if let Some(moment) = Local.timestamp_millis_opt(entry.timestamp).single() {
            day_totals
                .entry(moment.date_naive())
                .and_modify(|duration| *duration = duration.saturating_add(entry.duration_ms))
                .or_insert(entry.duration_ms);
        }
        if let Some(note) = note_by_path.get(&entry.note_path) {
            for tag in &note.tags {
                let total = tag_totals.entry(tag.clone()).or_default();
                total.0 = total.0.saturating_add(entry.duration_ms);
                total.1 += 1;
            }
            if let Some(minutes) = note.time_estimate_minutes {
                estimated += 1;
                if entry.duration_ms <= minutes.saturating_mul(60_000) {
                    met_estimate += 1;
                }
            }
        }
    }
    let mut sorted_notes = note_totals.into_iter().collect::<Vec<_>>();
    sorted_notes.sort_by_key(|(_, (duration, _))| std::cmp::Reverse(*duration));
    let mut sorted_tags = tag_totals.into_iter().collect::<Vec<_>>();
    sorted_tags.sort_by_key(|(_, (duration, _))| std::cmp::Reverse(*duration));
    let days_tracked = day_totals.len();
    let days_met_goal = if config.daily_goal_ms == 0 {
        0
    } else {
        day_totals
            .values()
            .filter(|duration| **duration >= config.daily_goal_ms)
            .count()
    };
    let goal_hit_rate = days_met_goal
        .saturating_mul(100)
        .checked_div(days_tracked)
        .unwrap_or(0);

    let mut markdown = format!(
        "# {label} Report — {}\n\n_Generated: {}_\n\n## Overview\n\n- **Period:** last {days} days\n- **Total time:** {}\n- **Total entries:** {}\n- **Average per entry:** {}\n- **Days tracked:** {days_tracked}\n- **Daily goal:** {}\n\n- **Days meeting goal:** {days_met_goal} / {days_tracked}\n- **Goal hit rate:** {goal_hit_rate}%\n\n",
        config.nick.as_deref().unwrap_or("mmStopWatch"),
        now.format("%Y-%m-%d %H:%M:%S"),
        format_duration(total_ms),
        entries.len(),
        format_duration(average_ms),
        format_duration(config.daily_goal_ms),
    );

    markdown.push_str("## Daily Breakdown\n\n| Date | Time | Goal |\n| :--- | :--- | :--- |\n");
    let today = now.date_naive();
    for days_ago in (0..days).rev() {
        let date = today - Duration::days(days_ago);
        let duration = day_totals.get(&date).copied().unwrap_or(0);
        let percent = if config.daily_goal_ms == 0 {
            0
        } else {
            ((duration as f64 / config.daily_goal_ms as f64) * 100.0).round() as u64
        };
        let icon = if config.daily_goal_ms > 0 && duration >= config.daily_goal_ms {
            "✅"
        } else if duration > 0 {
            "⚠️"
        } else {
            "—"
        };
        markdown.push_str(&format!(
            "| {} | {} | {icon} {percent}% |\n",
            date.format("%Y-%m-%d"),
            format_duration(duration),
        ));
    }
    markdown.push('\n');

    if !sorted_notes.is_empty() {
        markdown.push_str("## Top Notes\n\n| Note | Total | Sessions |\n| :--- | :--- | :--- |\n");
        for (name, (duration, count)) in sorted_notes.into_iter().take(15) {
            markdown.push_str(&format!(
                "| {} | {} | {} |\n",
                name.replace('|', "\\|"),
                format_duration(duration),
                count
            ));
        }
        markdown.push('\n');
    }
    if !sorted_tags.is_empty() {
        markdown.push_str("## Top Tags\n\n| Tag | Total | Sessions |\n| :--- | :--- | :--- |\n");
        for (tag, (duration, count)) in sorted_tags.into_iter().take(10) {
            markdown.push_str(&format!(
                "| {} | {} | {} |\n",
                tag.replace('|', "\\|"),
                format_duration(duration),
                count
            ));
        }
        markdown.push('\n');
    }
    if estimated > 0 {
        markdown.push_str(&format!(
            "## Estimate Accuracy\n\n- **Sessions with estimates:** {estimated}\n- **Met estimates:** {met_estimate}\n- **Missed estimates:** {}\n- **Accuracy:** {}%\n\n",
            estimated.saturating_sub(met_estimate),
            met_estimate.saturating_mul(100).checked_div(estimated).unwrap_or(0)
        ));
    }
    markdown.push_str("\n---\n\n_Report generated by mmStopWatch_\n");
    markdown
}

fn format_duration(milliseconds: u64) -> String {
    let seconds = milliseconds / 1_000;
    let hours = seconds / 3_600;
    let minutes = seconds / 60 % 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m {seconds}s")
    } else {
        format!("{seconds}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone};

    fn local_noon(date: NaiveDate) -> DateTime<Local> {
        Local
            .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
            .single()
            .expect("test noon must exist")
    }

    #[test]
    fn report_contains_daily_goals_tags_and_estimate_accuracy() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let now = local_noon(today);
        let note_path = PathBuf::from("/vault/note.md");
        let notes = vec![Note {
            path: note_path.clone(),
            name: "Note".into(),
            relative_path: "note.md".into(),
            duration_ms: 90 * 60_000,
            preview: String::new(),
            tags: vec!["dev".into()],
            time_estimate_minutes: Some(45),
            fields: HashMap::new(),
        }];
        let make_entry = |date: NaiveDate, duration_ms: u64, operation: &str| ActivityEntry {
            timestamp: local_noon(date).timestamp_millis(),
            duration_ms,
            note_path: note_path.to_string_lossy().into_owned(),
            note_name: "Note".into(),
            saved_at: now.timestamp_millis(),
            end_timestamp: local_noon(date).timestamp_millis() + duration_ms as i64,
            operation_id: operation.into(),
        };
        let entries = vec![
            make_entry(today, 60 * 60_000, "today"),
            make_entry(today - Duration::days(1), 30 * 60_000, "yesterday"),
        ];
        let config = AppConfig {
            nick: Some("tester".into()),
            daily_goal_ms: 45 * 60_000,
            ..AppConfig::default()
        };

        let markdown = build_report(&config, &notes, &entries, 7, now);
        assert!(markdown.contains("# Weekly Report — tester"));
        assert!(markdown.contains("**Days tracked:** 2"));
        assert!(markdown.contains("**Days meeting goal:** 1 / 2"));
        assert!(markdown.contains("## Daily Breakdown"));
        assert!(markdown.contains("## Top Tags"));
        assert!(markdown.contains("| dev | 1h 30m | 2 |"));
        assert!(markdown.contains("**Met estimates:** 1"));
        assert!(markdown.contains("**Missed estimates:** 1"));
        assert!(markdown.contains("**Accuracy:** 50%"));
    }

    #[test]
    fn duration_format_matches_existing_markdown_reports() {
        assert_eq!(format_duration(3_600_000), "1h 0m");
        assert_eq!(format_duration(65_000), "1m 5s");
        assert_eq!(format_duration(5_000), "5s");
    }
}
