#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod activity;
mod app_state;
mod config;
mod database;
mod i18n;
mod integration;
mod notification;
mod report;
mod stats;
mod storage;
mod timer;
mod updater;

use activity::append_activity;
use app_state::{
    AppState, COLORS, indexed_stats_field_keys, refresh_grid_row, refresh_models,
    refresh_note_model, set_status, sync_grid_model, timer_row,
};
use chrono::{Datelike, Local};
use config::AppConfig;
use integration::{obsidian_url, open_url};
use notification::{claim_expiration_once, play_sound, show as show_notification};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use report::save_report;
use slint::{CloseRequestResponse, Model, ModelRc, Timer, TimerMode};
use stats::snapshot as stats_snapshot;
use std::{
    cell::{Cell, RefCell},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    rc::Rc,
    sync::mpsc::{Receiver, Sender},
    thread,
    time::{Duration, Instant},
};
use storage::{Note, NoteIndex, NoteScan, create_note, write_time_estimate, write_total_duration};
use timer::NativeTimer;

slint::include_modules!();

type AsyncScanResult = (NoteIndex, Result<NoteScan, String>, String, String);

enum WatchSignal {
    Paths(Vec<PathBuf>),
    Reconcile,
}

struct VaultWatcher {
    watcher: RecommendedWatcher,
    root: Option<PathBuf>,
}

impl VaultWatcher {
    fn new(sender: Sender<WatchSignal>) -> Result<Self, String> {
        let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let signal = match result {
                Ok(event) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        return;
                    }
                    let markdown_paths = event
                        .paths
                        .iter()
                        .filter(|path| {
                            path.extension()
                                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                        })
                        .cloned()
                        .collect::<Vec<_>>();
                    if event.paths.iter().any(|path| path.is_dir())
                        || (markdown_paths.is_empty() && event.paths.len() > 1)
                    {
                        Some(WatchSignal::Reconcile)
                    } else if markdown_paths.is_empty() {
                        None
                    } else {
                        Some(WatchSignal::Paths(markdown_paths))
                    }
                }
                // An overflow or backend error means the index must reconcile
                // instead of trusting that no Markdown file changed.
                Err(_) => Some(WatchSignal::Reconcile),
            };
            if let Some(signal) = signal {
                let _ = sender.send(signal);
            }
        })
        .map_err(|error| error.to_string())?;
        Ok(Self {
            watcher,
            root: None,
        })
    }

    fn set_root(&mut self, root: Option<&Path>) -> Result<(), String> {
        if self.root.as_deref() == root {
            return Ok(());
        }
        if let Some(previous) = self.root.take() {
            let _ = self.watcher.unwatch(&previous);
        }
        if let Some(root) = root {
            let canonical = root.canonicalize().map_err(|error| error.to_string())?;
            self.watcher
                .watch(&canonical, RecursiveMode::Recursive)
                .map_err(|error| error.to_string())?;
            self.root = Some(canonical);
        }
        Ok(())
    }
}

fn scan_identity(config: &AppConfig) -> String {
    let field_keys = indexed_stats_field_keys(config);
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}",
        config
            .vault_path
            .as_deref()
            .map_or_else(String::new, |path| path.to_string_lossy().into_owned()),
        config.frontmatter_key,
        config.time_estimate_key,
        field_keys.join("\u{1e}")
    )
}

fn start_async_scan(
    ui: &AppWindow,
    state: &Rc<RefCell<AppState>>,
    sender: &Sender<AsyncScanResult>,
    completed_label: &str,
) {
    start_async_index_work(ui, state, sender, completed_label, None);
}

fn start_async_path_refresh(
    ui: &AppWindow,
    state: &Rc<RefCell<AppState>>,
    sender: &Sender<AsyncScanResult>,
    completed_label: &str,
    paths: Vec<PathBuf>,
) {
    if paths.is_empty() {
        return;
    }
    start_async_index_work(ui, state, sender, completed_label, Some(paths));
}

fn start_async_index_work(
    ui: &AppWindow,
    state: &Rc<RefCell<AppState>>,
    sender: &Sender<AsyncScanResult>,
    completed_label: &str,
    paths: Option<Vec<PathBuf>>,
) {
    let work = {
        let mut state = state.borrow_mut();
        if state.scan_in_progress {
            set_status(ui, "Index poznámek se už obnovuje…", false);
            return;
        }
        let Some(root) = state.config.vault_path.clone() else {
            set_status(ui, "Nejdřív vyberte složku s poznámkami.", true);
            return;
        };
        state.scan_in_progress = true;
        (
            std::mem::take(&mut state.note_index),
            root,
            state.config.frontmatter_key.clone(),
            state.config.time_estimate_key.clone(),
            indexed_stats_field_keys(&state.config),
            scan_identity(&state.config),
        )
    };
    ui.set_notes_loading(true);
    set_status(ui, "Obnovuji rychlý index poznámek…", false);
    let sender = sender.clone();
    let completed_label = completed_label.to_owned();
    thread::spawn(move || {
        let (mut index, root, key, estimate_key, field_keys, identity) = work;
        let result = match paths {
            Some(paths) => index.refresh_paths(&root, &key, &estimate_key, &field_keys, &paths),
            None => index.scan(&root, &key, &estimate_key, &field_keys),
        }
        .map_err(|error| error.to_string());
        let _ = sender.send((index, result, completed_label, identity));
    });
}

fn apply_async_scan_results(
    ui: &AppWindow,
    state: &Rc<RefCell<AppState>>,
    receiver: &Receiver<AsyncScanResult>,
) {
    while let Ok((index, result, completed_label, identity)) = receiver.try_recv() {
        let mut state = state.borrow_mut();
        state.scan_in_progress = false;
        ui.set_notes_loading(false);
        if scan_identity(&state.config) != identity {
            set_status(
                ui,
                "Výsledek staršího indexování byl přeskočen po změně trezoru nebo nastavení.",
                false,
            );
            continue;
        }
        state.index_cache_hits = index.cache_hits();
        state.index_metrics = index.metrics();
        state.index_revision = index.revision();
        state.note_index = index;
        match result {
            Ok(scan) => {
                state.apply_note_scan(scan);
                let count = state.notes.len();
                let metrics = state.index_metrics;
                refresh_models(ui, &state);
                set_status(
                    ui,
                    format!(
                        "{completed_label} {count} poznámek · {} z cache · {} změn · {} ms",
                        metrics.cache_hits,
                        metrics.parsed_files + metrics.deleted_files,
                        metrics.elapsed.as_millis()
                    ),
                    false,
                );
            }
            Err(error) => set_status(ui, error, true),
        }
    }
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

fn install_scroll_benchmark_fixture(state: &mut AppState, note_count: usize) {
    state.notes = (0..note_count)
        .map(|index| Note {
            path: PathBuf::from(format!(
                "/benchmark/group-{}/note-{index:05}.md",
                index % 100
            )),
            name: format!("Benchmark note {index:05}"),
            relative_path: format!("group-{}/note-{index:05}.md", index % 100),
            duration_ms: (index as u64 % 3_600) * 1_000,
            preview: String::new(),
            tags: vec!["benchmark".into(), format!("group-{}", index % 10)],
            time_estimate_minutes: Some(30),
            fields: Default::default(),
        })
        .collect();
    state.visible_notes = (0..note_count).collect();
    state.loaded_note_count = note_count;
    state.rebuild_note_rows();
}

fn stats_calendar_day_row(day: &stats::CalendarDay) -> StatsCalendarDayRow {
    StatsCalendarDayRow {
        day: day.date.day().to_string().into(),
        duration: if day.duration_ms == 0 {
            "".into()
        } else {
            storage::format_time(day.duration_ms).into()
        },
        progress: day.goal_progress,
        goal_met: day.goal_met,
        in_month: day.in_month,
        today: day.today,
    }
}

fn set_stats_calendar(ui: &AppWindow, calendar: stats::CalendarSnapshot) {
    ui.set_stats_calendar_month(calendar.month.into());
    ui.set_stats_calendar(ModelRc::new(slint::VecModel::from(
        calendar
            .days
            .as_chunks::<7>()
            .0
            .iter()
            .map(|week| StatsCalendarWeekRow {
                monday: stats_calendar_day_row(&week[0]),
                tuesday: stats_calendar_day_row(&week[1]),
                wednesday: stats_calendar_day_row(&week[2]),
                thursday: stats_calendar_day_row(&week[3]),
                friday: stats_calendar_day_row(&week[4]),
                saturday: stats_calendar_day_row(&week[5]),
                sunday: stats_calendar_day_row(&week[6]),
            })
            .collect::<Vec<_>>(),
    )));
}

fn format_productivity_slope(slope_ms: i64) -> String {
    if slope_ms.abs() <= 100 {
        return "→ stabilní".into();
    }
    let arrow = if slope_ms > 0 { "↑" } else { "↓" };
    let seconds = slope_ms.unsigned_abs() as f64 / 1_000.0;
    if seconds >= 3_600.0 {
        format!("{arrow} {:.1} h / den", seconds / 3_600.0)
    } else if seconds >= 60.0 {
        format!("{arrow} {:.1} min / den", seconds / 60.0)
    } else {
        format!("{arrow} {seconds:.1} s / den")
    }
}

fn available_stats_profiles(config: &AppConfig) -> Vec<AppConfig> {
    let mut profiles = config.available_profiles();
    if let Some(active_nick) = config.nick.as_deref() {
        if let Some(active) = profiles
            .iter_mut()
            .find(|profile| profile.nick.as_deref() == Some(active_nick))
        {
            *active = config.clone();
        } else {
            profiles.push(config.clone());
        }
    } else if profiles.is_empty() {
        profiles.push(config.clone());
    }
    profiles
}

fn active_stats_profile_index(config: &AppConfig, profiles: &[AppConfig]) -> usize {
    profiles
        .iter()
        .position(|profile| profile.nick == config.nick)
        .unwrap_or(0)
}

fn set_stats_snapshot(ui: &AppWindow, snapshot: stats::StatsSnapshot) {
    ui.set_stats_breakdown_count(snapshot.breakdown.len() as i32);
    ui.set_stats_total(storage::format_time(snapshot.total_ms).into());
    ui.set_stats_today(storage::format_time(snapshot.today_ms).into());
    ui.set_stats_week(storage::format_time(snapshot.week_ms).into());
    ui.set_stats_month(storage::format_time(snapshot.month_ms).into());
    ui.set_stats_average(storage::format_time(snapshot.average_ms).into());
    ui.set_stats_longest(storage::format_time(snapshot.longest_ms).into());
    ui.set_stats_count(snapshot.count as i32);
    ui.set_goal_progress(snapshot.goal_progress);
    ui.set_stats_streak(snapshot.streak_days as i32);
    ui.set_stats_consistency(snapshot.consistency_percent as i32);
    ui.set_stats_weekly_delta(snapshot.weekly_delta_percent);
    ui.set_stats_best_weekday(snapshot.best_weekday.into());
    ui.set_stats_peak_hour(snapshot.peak_hour.into());
    ui.set_stats_weekday_average(storage::format_time(snapshot.weekday_average_ms).into());
    ui.set_stats_weekend_average(storage::format_time(snapshot.weekend_average_ms).into());
    ui.set_stats_night_percent(snapshot.night_percent as i32);
    ui.set_stats_productivity_direction(snapshot.productivity_slope_ms.signum() as i32);
    ui.set_stats_productivity(format_productivity_slope(snapshot.productivity_slope_ms).into());
    ui.set_stats_weekdays(ModelRc::new(slint::VecModel::from(
        snapshot
            .weekdays
            .into_iter()
            .map(|row| StatsTrendRow {
                label: row.label.into(),
                duration: storage::format_time(row.duration_ms).into(),
                progress: row.progress,
            })
            .collect::<Vec<_>>(),
    )));
    ui.set_stats_hours(ModelRc::new(slint::VecModel::from(
        snapshot
            .hours
            .into_iter()
            .map(|row| StatsTrendRow {
                label: row.label.into(),
                duration: storage::format_time(row.duration_ms).into(),
                progress: row.progress,
            })
            .collect::<Vec<_>>(),
    )));
    set_stats_calendar(
        ui,
        stats::CalendarSnapshot {
            month: snapshot.calendar_month,
            days: snapshot.calendar,
        },
    );
    ui.set_stats_days(ModelRc::new(slint::VecModel::from(
        snapshot
            .daily
            .into_iter()
            .map(|day| StatsDayRow {
                date: day.date.format("%d.%m.").to_string().into(),
                duration: storage::format_time(day.duration_ms).into(),
                progress: day.goal_progress,
                goal_met: day.goal_met,
            })
            .collect::<Vec<_>>(),
    )));
    ui.set_stats_notes(ModelRc::new(slint::VecModel::from(
        snapshot
            .top_notes
            .into_iter()
            .map(|note| StatsRow {
                name: note.name.into(),
                duration: storage::format_time(note.duration_ms).into(),
                count: note.count as i32,
            })
            .collect::<Vec<_>>(),
    )));
    ui.set_stats_breakdown(ModelRc::new(slint::VecModel::from(
        snapshot
            .breakdown
            .into_iter()
            .map(|row| StatsRow {
                name: format!("{} · {}", row.field, row.value).into(),
                duration: storage::format_time(row.duration_ms).into(),
                count: row.count as i32,
            })
            .collect::<Vec<_>>(),
    )));
}

fn present_stats_profile(
    ui: &AppWindow,
    state: &AppState,
    requested_index: usize,
    calendar_offset: i32,
) -> usize {
    let profiles = available_stats_profiles(&state.config);
    let index = requested_index.min(profiles.len().saturating_sub(1));
    let profile = &profiles[index];
    ui.set_stats_profile_index(index as i32);
    ui.set_stats_profile_count(profiles.len().max(1) as i32);
    ui.set_stats_profile_name(
        profile
            .nick
            .clone()
            .unwrap_or_else(|| "výchozí".into())
            .into(),
    );
    ui.set_stats_profile_active(profile.nick == state.config.nick);
    set_stats_snapshot(ui, stats_snapshot(profile, &state.notes));
    if calendar_offset != 0 {
        set_stats_calendar(ui, stats::calendar_snapshot(profile, calendar_offset));
    }
    index
}

fn sync_settings(ui: &AppWindow, config: &AppConfig) {
    I18n::get(ui).set_language(config.language.clone().into());
    ui.set_settings_nick(config.nick.clone().unwrap_or_default().into());
    ui.set_settings_frontmatter(config.frontmatter_key.clone().into());
    ui.set_settings_estimate_key(config.time_estimate_key.clone().into());
    ui.set_settings_time_format(config.time_format.clone().into());
    ui.set_settings_obsidian_vault(config.obsidian_vault.clone().into());
    ui.set_settings_stats_fields(config.stats_field_keys.join(", ").into());
    ui.set_settings_language(config.language.clone().into());
    ui.set_settings_daily_goal(format!("{:.1}", config.daily_goal_ms as f64 / 3_600_000.0).into());
    ui.set_settings_auto_refresh(config.auto_refresh_interval.to_string().into());
    ui.set_settings_notifications(config.notifications.enabled);
    ui.set_settings_notification_interval(config.notifications.interval_minutes.to_string().into());
    ui.set_settings_limit_enabled(config.timer_limit_alert.enabled);
    ui.set_settings_limit_sound_enabled(config.timer_limit_alert.sound_enabled);
    ui.set_settings_limit_sound_path(
        config
            .timer_limit_alert
            .sound_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
            .into(),
    );
    ui.set_settings_limit_notification_enabled(config.timer_limit_alert.notifications_enabled);
    ui.set_settings_limit_overlay(config.timer_limit_alert.show_overlay);
    ui.set_settings_limit_message(config.timer_limit_alert.custom_message.clone().into());
    ui.set_table_view(config.timer_view_mode == "table");
    let columns = config
        .timer_layout
        .mode
        .strip_prefix("grid-")
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(1);
    ui.set_layout_columns(columns.clamp(1, 4));
    ui.set_profiles(ModelRc::new(slint::VecModel::from(
        config
            .available_profiles()
            .into_iter()
            .map(|profile| {
                let nick = profile.nick.unwrap_or_else(|| "profil".into());
                ProfileRow {
                    active: config.nick.as_deref() == Some(nick.as_str()),
                    nick: nick.into(),
                }
            })
            .collect::<Vec<_>>(),
    )));
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn apply_editable_settings(ui: &AppWindow, config: &mut AppConfig) -> Result<(), String> {
    let frontmatter = ui.get_settings_frontmatter().trim().to_owned();
    let estimate_key = ui.get_settings_estimate_key().trim().to_owned();
    let nick = ui.get_settings_nick().trim().to_owned();
    if !valid_key(&frontmatter)
        || !valid_key(&estimate_key)
        || (!nick.is_empty() && !valid_key(&nick))
    {
        return Err("Název profilu nebo frontmatter pole není platný.".into());
    }
    let goal_hours = ui
        .get_settings_daily_goal()
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && (0.0..=24.0).contains(value))
        .ok_or_else(|| "Denní cíl musí být číslo od 0 do 24 hodin.".to_owned())?;
    let refresh = ui
        .get_settings_auto_refresh()
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|value| *value <= 120)
        .ok_or_else(|| "Automatické obnovení musí být 0 až 120 minut.".to_owned())?;
    let notification_interval = ui
        .get_settings_notification_interval()
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|value| *value <= 1_440)
        .ok_or_else(|| "Interval upozornění musí být 0 až 1440 minut.".to_owned())?;
    let time_format = ui.get_settings_time_format().trim().to_owned();
    if time_format.is_empty() || time_format.len() > 40 {
        return Err("Formát času nesmí být prázdný.".into());
    }
    let stats_fields = ui
        .get_settings_stats_fields()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if stats_fields.len() > 12 || stats_fields.iter().any(|field| !valid_key(field)) {
        return Err("Pole statistik musí být platné klíče oddělené čárkou (nejvýše 12).".into());
    }

    config.nick = (!nick.is_empty()).then_some(nick);
    config.frontmatter_key = frontmatter;
    config.time_estimate_key = estimate_key;
    config.time_format = time_format;
    config.obsidian_vault = ui.get_settings_obsidian_vault().trim().to_owned();
    config.stats_field_keys = stats_fields;
    let language = ui.get_settings_language().trim().to_owned();
    if !i18n::Catalog::supports(&language) {
        return Err(format!(
            "Nepodporovaný jazyk. Použijte jeden z: {}.",
            i18n::LANGUAGES.join(", ")
        ));
    }
    config.language = language;
    config.daily_goal_ms = (goal_hours * 3_600_000.0) as u64;
    config.auto_refresh_interval = refresh;
    config.notifications.enabled = ui.get_settings_notifications();
    config.notifications.interval_minutes = notification_interval;
    config.timer_limit_alert.enabled = ui.get_settings_limit_enabled();
    config.timer_limit_alert.sound_enabled = ui.get_settings_limit_sound_enabled();
    let sound_path = ui.get_settings_limit_sound_path().trim().to_owned();
    config.timer_limit_alert.sound_path =
        (!sound_path.is_empty()).then(|| PathBuf::from(sound_path));
    config.timer_limit_alert.notifications_enabled = ui.get_settings_limit_notification_enabled();
    config.timer_limit_alert.show_overlay = ui.get_settings_limit_overlay();
    let custom_message = ui.get_settings_limit_message().trim().to_owned();
    if custom_message.len() > 500 {
        return Err("Vlastní zpráva může mít nejvýše 500 znaků.".into());
    }
    config.timer_limit_alert.custom_message = custom_message;
    Ok(())
}

fn present_update_result(ui: &AppWindow, result: Result<updater::UpdateCheck, String>) {
    match result {
        Ok(update)
            if update.available && update.download_url.is_some() && update.sha256.is_some() =>
        {
            let language = I18n::get(ui).get_language();
            let release_note = update.notes.lines().next().unwrap_or_default();
            let status = format!(
                "{}: {} — {} GitHub Release a instalátor spusťte ručně{}",
                i18n::tr(language.as_str(), "updateAvailable"),
                update.version,
                i18n::tr(language.as_str(), "open"),
                if release_note.is_empty() {
                    String::new()
                } else {
                    format!(" — {release_note}")
                }
            );
            ui.set_update_release_url(update.download_url.unwrap_or_default().into());
            ui.set_updater_status(status.into());
            ui.set_update_available(true);
        }
        Ok(update) if update.available => {
            ui.set_update_release_url("".into());
            ui.set_updater_status(
                format!(
                    "Verze {} je dostupná, ale pro tuto platformu není ověřený instalátor.",
                    update.version
                )
                .into(),
            );
            ui.set_update_available(false);
        }
        Ok(_) => {
            ui.set_update_release_url("".into());
            ui.set_updater_status(
                i18n::tr(I18n::get(ui).get_language().as_str(), "upToDate").into(),
            );
            ui.set_update_available(false);
        }
        Err(error) => {
            ui.set_update_release_url("".into());
            ui.set_updater_status(error.into());
            ui.set_update_available(false);
        }
    }
}

fn save_all_timers(state: &mut AppState) -> Result<(), String> {
    let mut saved = Vec::with_capacity(state.timers.len());
    for timer in &mut state.timers {
        timer.pause();
        let path = PathBuf::from(&timer.note_path);
        let elapsed = timer.current_elapsed_ms();
        let added = timer.added_elapsed_ms();
        let operation_id = format!("native:{}:{elapsed}", path.to_string_lossy());
        write_total_duration(&path, &state.config.frontmatter_key, elapsed)
            .map_err(|error| format!("{}: {error}", timer.name))?;
        append_activity(&state.config, added, &path, &timer.name, &operation_id)
            .map_err(|error| format!("{}: {error}", timer.name))?;
        saved.push((path, elapsed));
    }
    for (path, elapsed) in saved {
        if let Some(note) = state.notes.iter_mut().find(|note| note.path == path) {
            note.duration_ms = elapsed;
        }
    }
    state.timers.clear();
    state.checkpoint_timers();
    Ok(())
}

fn main() -> Result<(), slint::PlatformError> {
    let mut config = AppConfig::load();
    if let Some(argument) = std::env::args_os().nth(1) {
        let _ = config.adopt_vault(PathBuf::from(argument));
    } else if config.vault_path.is_some() && config.restore_selected_profile() {
        let _ = config.save();
    }
    if let Ok(columns) = std::env::var("MMSTOPWATCH_PREVIEW_COLUMNS")
        && let Ok(columns) = columns.parse::<usize>()
    {
        config.timer_layout.mode = format!("grid-{}", columns.clamp(1, 4));
    }
    if std::env::var_os("MMSTOPWATCH_PREVIEW_TABLE").is_some() {
        config.timer_view_mode = "table".into();
    }
    if let Ok(language) = std::env::var("MMSTOPWATCH_PREVIEW_LANGUAGE")
        && i18n::Catalog::supports(&language)
    {
        config.language = language;
    }

    let ui = AppWindow::new()?;
    ui.set_app_version(env!("CARGO_PKG_VERSION").into());
    I18n::get(&ui).on_tr(move |language, key| i18n::tr(language.as_str(), key.as_str()).into());
    if let (Ok(width), Ok(height)) = (
        std::env::var("MMSTOPWATCH_PREVIEW_WIDTH"),
        std::env::var("MMSTOPWATCH_PREVIEW_HEIGHT"),
    ) && let (Ok(width), Ok(height)) = (width.parse::<u32>(), height.parse::<u32>())
    {
        ui.set_preview_width(width.clamp(360, 3_840) as f32);
        ui.set_preview_height(height.clamp(500, 2_160) as f32);
        ui.set_force_compact(width < 760);
    }
    ui.set_vault_path(
        config
            .vault_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
            .into(),
    );
    sync_settings(&ui, &config);
    ui.set_onboarding_visible(config.vault_path.is_none());
    ui.set_new_note_filename(Local::now().format("%Y-%m-%d.md").to_string().into());
    let preview_count = std::env::var("MMSTOPWATCH_PREVIEW_TIMERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_else(|| usize::from(std::env::var_os("MMSTOPWATCH_PREVIEW_TIMER").is_some()));
    let scroll_benchmark_count = std::env::var("MMSTOPWATCH_SCROLL_BENCHMARK")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|count| (1..=50_000).contains(count));
    let diagnostics = preview_count > 0 || scroll_benchmark_count.is_some();
    let state = Rc::new(RefCell::new(AppState::new(config, diagnostics)));
    let (scan_sender, scan_receiver) = std::sync::mpsc::channel::<AsyncScanResult>();
    let (watch_sender, watch_receiver) = std::sync::mpsc::channel::<WatchSignal>();
    let last_sidebar_scroll = Rc::new(Cell::new(
        Instant::now()
            .checked_sub(Duration::from_secs(1))
            .unwrap_or_else(Instant::now),
    ));
    let watcher = Rc::new(RefCell::new(match VaultWatcher::new(watch_sender) {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            eprintln!("vault watcher unavailable: {error}");
            None
        }
    }));
    if let Some(active_watcher) = watcher.borrow_mut().as_mut() {
        let root = state.borrow().config.vault_path.clone();
        if let Err(error) = active_watcher.set_root(root.as_deref()) {
            eprintln!("vault watcher unavailable: {error}");
        }
    }
    ui.set_notes(ModelRc::from(state.borrow().note_model.clone()));
    ui.set_timers(ModelRc::from(state.borrow().timer_model.clone()));
    ui.set_timer_grid(ModelRc::from(state.borrow().timer_grid_model.clone()));

    let sidebar_scroll_idle_tick = Rc::new(Timer::default());
    {
        let weak = ui.as_weak();
        let last_sidebar_scroll = last_sidebar_scroll.clone();
        let sidebar_scroll_idle_tick = sidebar_scroll_idle_tick.clone();
        ui.on_sidebar_scrolled(move || {
            last_sidebar_scroll.set(Instant::now());
            let Some(ui) = weak.upgrade() else { return };
            ui.set_sidebar_scrolling(true);
            let weak = weak.clone();
            sidebar_scroll_idle_tick.start(
                TimerMode::SingleShot,
                Duration::from_millis(180),
                move || {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_sidebar_scrolling(false);
                    }
                },
            );
        });
    }

    {
        let weak = ui.as_weak();
        ui.on_check_update(move || {
            let Some(ui) = weak.upgrade() else { return };
            ui.set_updater_status(
                i18n::tr(I18n::get(&ui).get_language().as_str(), "notesLoading").into(),
            );
            ui.set_update_available(false);
            let worker_weak = weak.clone();
            thread::spawn(move || {
                let result = updater::check(env!("CARGO_PKG_VERSION"));
                let _ = worker_weak.upgrade_in_event_loop(move |ui| {
                    present_update_result(&ui, result);
                });
            });
        });
    }
    {
        let weak = ui.as_weak();
        ui.on_open_update(move || {
            let Some(ui) = weak.upgrade() else { return };
            let url = ui.get_update_release_url();
            if url.is_empty() {
                set_status(&ui, "Odkaz na GitHub Release není dostupný.", true);
                return;
            }
            if let Err(error) = open_url(url.as_str()) {
                set_status(&ui, format!("GitHub Release nelze otevřít: {error}"), true);
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_delete_profile(move |index| {
            let Some(ui) = weak.upgrade() else { return };
            if !state.borrow().timers.is_empty() {
                set_status(
                    &ui,
                    "Před archivací profilu uložte nebo zahoďte časomíry.",
                    true,
                );
                return;
            }
            let profile = {
                let state = state.borrow();
                state
                    .config
                    .available_profiles()
                    .get(index as usize)
                    .cloned()
            };
            let Some(profile) = profile else { return };
            let Some(nick) = profile.nick else { return };
            let state = state.borrow();
            if state.config.nick.as_deref() == Some(nick.as_str()) {
                set_status(
                    &ui,
                    "Aktivní profil nelze archivovat. Nejdřív přepněte jiný.",
                    true,
                );
                return;
            }
            match state.config.archive_profile(&nick) {
                Ok(path) => {
                    sync_settings(&ui, &state.config);
                    set_status(
                        &ui,
                        format!("Profil byl přesunut do {}", path.to_string_lossy()),
                        false,
                    );
                }
                Err(error) => set_status(&ui, format!("Profil nelze archivovat: {error}"), true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_switch_profile(move |index| {
            let Some(ui) = weak.upgrade() else { return };
            if !state.borrow().timers.is_empty() {
                set_status(
                    &ui,
                    "Před přepnutím profilu uložte nebo zahoďte časomíry.",
                    true,
                );
                return;
            }
            let nick = {
                let state = state.borrow();
                state
                    .config
                    .available_profiles()
                    .get(index as usize)
                    .and_then(|profile| profile.nick.clone())
            };
            let Some(nick) = nick else { return };
            let mut state = state.borrow_mut();
            match state.config.switch_profile(&nick) {
                Ok(()) => match state.reload() {
                    Ok(_) => {
                        sync_settings(&ui, &state.config);
                        refresh_models(&ui, &state);
                        set_status(&ui, format!("Aktivní profil: {nick}"), false);
                    }
                    Err(error) => set_status(&ui, error, true),
                },
                Err(error) => set_status(&ui, format!("Profil nelze přepnout: {error}"), true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_create_profile(move || {
            let Some(ui) = weak.upgrade() else { return };
            if !state.borrow().timers.is_empty() {
                set_status(
                    &ui,
                    "Před vytvořením profilu uložte nebo zahoďte časomíry.",
                    true,
                );
                return;
            }
            let nick = ui.get_settings_nick().trim().to_owned();
            if !valid_key(&nick) {
                set_status(&ui, "Zadejte platný název nového profilu.", true);
                return;
            }
            let mut state = state.borrow_mut();
            if state
                .config
                .available_profiles()
                .iter()
                .any(|profile| profile.nick.as_deref() == Some(nick.as_str()))
            {
                set_status(&ui, "Profil s tímto názvem už existuje.", true);
                return;
            }
            state.config.nick = Some(nick.clone());
            state.config.onboarding_complete = true;
            if let Err(error) = state
                .config
                .save_profile()
                .and_then(|()| state.config.save())
            {
                set_status(&ui, format!("Profil nelze vytvořit: {error}"), true);
                return;
            }
            sync_settings(&ui, &state.config);
            set_status(&ui, format!("Profil „{nick}“ byl vytvořen."), false);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.window().on_close_requested(move || {
            let Some(ui) = weak.upgrade() else {
                return CloseRequestResponse::HideWindow;
            };
            if state.borrow().timers.is_empty() {
                CloseRequestResponse::HideWindow
            } else {
                state.borrow().checkpoint_timers();
                ui.set_close_guard_open(true);
                CloseRequestResponse::KeepWindowShown
            }
        });
    }

    let mut scroll_fixture_elapsed = Duration::ZERO;
    if state.borrow().config.vault_path.is_some() {
        match state.borrow_mut().reload() {
            Ok(count) => set_status(&ui, format!("Načteno {count} poznámek"), false),
            Err(error) => set_status(&ui, error, true),
        }
    }
    if let Some(note_count) = scroll_benchmark_count {
        let started = Instant::now();
        install_scroll_benchmark_fixture(&mut state.borrow_mut(), note_count);
        scroll_fixture_elapsed = started.elapsed();
        ui.set_onboarding_visible(false);
        ui.set_vault_path("syntetický scroll benchmark".into());
    }
    state.borrow_mut().restore_timers();

    if preview_count > 0 {
        let mut state = state.borrow_mut();
        let preview_notes = state
            .notes
            .iter()
            .take(preview_count)
            .cloned()
            .collect::<Vec<_>>();
        for (index, note) in preview_notes.iter().enumerate() {
            let rgb = COLORS[index % COLORS.len()];
            let mut timer = NativeTimer::new(
                note.path.to_string_lossy().into_owned(),
                note.name.clone(),
                note.duration_ms,
                note.time_estimate_minutes.or(Some(45)),
                slint::Color::from_rgb_u8((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8),
            );
            timer.toggle();
            state.timers.push(timer);
        }
    }
    refresh_models(&ui, &state.borrow());

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_move_timer(move |index, offset| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            if !state.move_timer(index as usize, offset as isize) {
                return;
            }
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Pořadí časomír nelze uložit: {error}"), true);
            }
            refresh_models(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let sort_column = Rc::new(Cell::new(-1_i32));
        let sort_ascending = Rc::new(Cell::new(true));
        ui.on_sort_timers(move |column| {
            let Some(ui) = weak.upgrade() else { return };
            let ascending = if sort_column.get() == column {
                !sort_ascending.get()
            } else {
                true
            };
            sort_column.set(column);
            sort_ascending.set(ascending);
            let mut state = state.borrow_mut();
            state.timers.sort_by(|left, right| {
                let order = match column {
                    0 => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
                    1 => left.time_estimate_minutes.cmp(&right.time_estimate_minutes),
                    2 => left.current_elapsed_ms().cmp(&right.current_elapsed_ms()),
                    3 => left.is_running().cmp(&right.is_running()),
                    _ => std::cmp::Ordering::Equal,
                };
                if ascending { order } else { order.reverse() }
            });
            state.remember_timer_order();
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Seřazení časomír nelze uložit: {error}"), true);
            }
            refresh_models(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        ui.on_save_custom_estimate(move |index, value| {
            let Some(ui) = weak.upgrade() else { return };
            let Some(minutes) = value
                .trim()
                .parse::<u32>()
                .ok()
                .filter(|minutes| *minutes <= 10_080)
            else {
                set_status(&ui, "Odhad musí být celé číslo od 0 do 10080 minut.", true);
                return;
            };
            ui.invoke_set_timer_estimate(index, minutes as i32);
            ui.set_custom_estimate_open(false);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_set_timer_view(move |table| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            state.config.timer_view_mode = if table { "table" } else { "cards" }.into();
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Režim zobrazení nelze uložit: {error}"), true);
            }
            ui.set_table_view(table);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_set_layout_columns(move |columns| {
            let Some(ui) = weak.upgrade() else { return };
            let columns = columns.clamp(1, 4);
            let mut state = state.borrow_mut();
            state.config.timer_layout.mode = if columns == 1 {
                "list".into()
            } else {
                format!("grid-{columns}")
            };
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Rozložení nelze uložit: {error}"), true);
            }
            ui.set_layout_columns(columns);
            sync_grid_model(&state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_close_save_all(move || {
            let Some(ui) = weak.upgrade() else { return };
            match save_all_timers(&mut state.borrow_mut()) {
                Ok(()) => {
                    ui.set_close_guard_open(false);
                    let _ = slint::quit_event_loop();
                }
                Err(error) => {
                    set_status(&ui, format!("Uložení před zavřením selhalo: {error}"), true)
                }
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_close_discard_all(move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            state.timers.clear();
            state.checkpoint_timers();
            ui.set_close_guard_open(false);
            let _ = slint::quit_event_loop();
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_create_note(move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let Some(root) = state.config.vault_path.as_deref() else {
                set_status(&ui, "Nejdřív vyberte složku poznámek.", true);
                return;
            };
            match create_note(
                root,
                ui.get_new_note_filename().as_str(),
                &state.config.frontmatter_key,
                ui.get_new_note_time().as_str(),
                ui.get_new_note_tags().as_str(),
            ) {
                Ok(_) => match state.reload() {
                    Ok(_) => {
                        refresh_models(&ui, &state);
                        ui.set_new_note_open(false);
                        ui.set_new_note_time("".into());
                        ui.set_new_note_tags("".into());
                        set_status(&ui, "Nová poznámka byla vytvořena.", false);
                    }
                    Err(error) => set_status(&ui, error, true),
                },
                Err(error) => set_status(&ui, format!("Poznámku nelze vytvořit: {error}"), true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_settings(move || {
            let Some(ui) = weak.upgrade() else { return };
            sync_settings(&ui, &state.borrow().config);
            ui.set_settings_open(true);
        });
    }

    {
        let weak = ui.as_weak();
        ui.on_choose_alert_sound(move || {
            let Some(ui) = weak.upgrade() else { return };
            let Some(path) = rfd::FileDialog::new()
                .set_title("Vyberte zvuk upozornění")
                .add_filter("Zvuk", &["wav", "ogg", "mp3", "flac"])
                .pick_file()
            else {
                return;
            };
            ui.set_settings_limit_sound_path(path.to_string_lossy().into_owned().into());
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_settings(move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            if let Err(error) = apply_editable_settings(&ui, &mut state.config) {
                set_status(&ui, error, true);
                return;
            }
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(
                    &ui,
                    format!("Nastavení se nepodařilo uložit: {error}"),
                    true,
                );
                return;
            }
            match state.reload() {
                Ok(_) => {
                    sync_settings(&ui, &state.config);
                    refresh_models(&ui, &state);
                    set_status(&ui, "Nastavení bylo uloženo.", false);
                    ui.set_settings_open(false);
                }
                Err(error) => set_status(&ui, error, true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_complete_onboarding(move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            if state.config.vault_path.is_none() {
                ui.set_onboarding_step(0);
                set_status(&ui, "Nejdřív vyberte složku poznámek.", true);
                return;
            }
            if ui.get_settings_nick().trim().is_empty() {
                ui.set_onboarding_step(1);
                set_status(&ui, "Zadejte název profilu.", true);
                return;
            }
            if let Err(error) = apply_editable_settings(&ui, &mut state.config) {
                set_status(&ui, error, true);
                return;
            }
            state.config.onboarding_complete = true;
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Nastavení nelze dokončit: {error}"), true);
                return;
            }
            match state.reload() {
                Ok(count) => {
                    sync_settings(&ui, &state.config);
                    refresh_models(&ui, &state);
                    ui.set_onboarding_visible(false);
                    set_status(&ui, format!("Hotovo, načteno {count} poznámek."), false);
                }
                Err(error) => set_status(&ui, error, true),
            }
        });
    }

    let stats_calendar_offset = Rc::new(Cell::new(0_i32));
    let stats_profile_index = Rc::new(Cell::new(0_usize));
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let calendar_offset = stats_calendar_offset.clone();
        let profile_index = stats_profile_index.clone();
        ui.on_open_stats(move || {
            let Some(ui) = weak.upgrade() else { return };
            calendar_offset.set(0);
            let state = state.borrow();
            let profiles = available_stats_profiles(&state.config);
            let active_index = active_stats_profile_index(&state.config, &profiles);
            profile_index.set(present_stats_profile(&ui, &state, active_index, 0));
            ui.set_stats_open(true);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let calendar_offset = stats_calendar_offset.clone();
        let profile_index = stats_profile_index.clone();
        ui.on_shift_stats_profile(move |delta| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let profile_count = available_stats_profiles(&state.config).len().max(1);
            let next = profile_index
                .get()
                .saturating_add_signed(delta as isize)
                .min(profile_count - 1);
            if next == profile_index.get() {
                return;
            }
            calendar_offset.set(0);
            profile_index.set(present_stats_profile(&ui, &state, next, 0));
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let calendar_offset = stats_calendar_offset.clone();
        let profile_index = stats_profile_index.clone();
        ui.on_shift_stats_calendar(move |delta| {
            let Some(ui) = weak.upgrade() else { return };
            let offset = calendar_offset.get().saturating_add(delta).clamp(-120, 120);
            calendar_offset.set(offset);
            let state = state.borrow();
            let profiles = available_stats_profiles(&state.config);
            let index = profile_index.get().min(profiles.len().saturating_sub(1));
            set_stats_calendar(&ui, stats::calendar_snapshot(&profiles[index], offset));
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let profile_index = stats_profile_index;
        ui.on_export_report(move |monthly| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let profiles = available_stats_profiles(&state.config);
            let index = profile_index.get().min(profiles.len().saturating_sub(1));
            match save_report(&profiles[index], &state.notes, if monthly { 30 } else { 7 }) {
                Ok(path) => set_status(
                    &ui,
                    format!("Report byl uložen do {}", path.to_string_lossy()),
                    false,
                ),
                Err(error) => set_status(&ui, format!("Report nelze uložit: {error}"), true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let watcher = watcher.clone();
        ui.on_choose_folder(move || {
            let Some(ui) = weak.upgrade() else { return };
            let onboarding = ui.get_onboarding_visible();
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
                ui.set_vault_path(folder.to_string_lossy().into_owned().into());
                if let Err(error) = state.config.adopt_vault(folder) {
                    set_status(
                        &ui,
                        format!("Konfiguraci se nepodařilo uložit: {error}"),
                        true,
                    );
                }
                if let Some(active_watcher) = watcher.borrow_mut().as_mut()
                    && let Err(error) = active_watcher.set_root(state.config.vault_path.as_deref())
                {
                    eprintln!("vault watcher unavailable: {error}");
                }
                match state.reload() {
                    Ok(count) => set_status(&ui, format!("Načteno {count} poznámek"), false),
                    Err(error) => set_status(&ui, error, true),
                }
                sync_settings(&ui, &state.config);
                if onboarding {
                    ui.set_onboarding_step(1);
                } else {
                    ui.set_onboarding_visible(false);
                }
            }
            refresh_models(&ui, &state.borrow());
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let scan_sender = scan_sender.clone();
        ui.on_refresh(move || {
            let Some(ui) = weak.upgrade() else { return };
            start_async_scan(&ui, &state, &scan_sender, "Obnoveno");
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
            refresh_note_model(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_load_more_notes(move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            if state.load_more_notes() {
                refresh_note_model(&ui, &state);
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_preview_note(move |visible_index| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let Some(note_index) = state.visible_notes.get(visible_index as usize).copied() else {
                return;
            };
            let note = &state.notes[note_index];
            ui.set_preview_title(note.name.clone().into());
            ui.set_preview_path(note.relative_path.clone().into());
            ui.set_preview_body(note.preview.clone().into());
            ui.set_preview_open(true);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_edit_note(move |visible_index| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let Some(note_index) = state.visible_notes.get(visible_index as usize).copied() else {
                return;
            };
            let note = &state.notes[note_index];
            if state
                .timers
                .iter()
                .any(|timer| timer.note_path == note.path.to_string_lossy())
            {
                set_status(
                    &ui,
                    "Čas aktivní poznámky upravte přes její časomíru.",
                    true,
                );
                return;
            }
            ui.set_edit_note_title(note.name.clone().into());
            ui.set_edit_note_path(note.path.to_string_lossy().into_owned().into());
            ui.set_edit_note_time(storage::format_time(note.duration_ms).into());
            ui.set_edit_note_open(true);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_note_edit(move || {
            let Some(ui) = weak.upgrade() else { return };
            let path = PathBuf::from(ui.get_edit_note_path().as_str());
            let Some(duration) = storage::parse_time_ms(ui.get_edit_note_time().as_str()) else {
                set_status(&ui, "Zadaný čas není platný.", true);
                return;
            };
            let mut state = state.borrow_mut();
            if !state.notes.iter().any(|note| note.path == path) {
                set_status(&ui, "Poznámka už ve vaultu neexistuje.", true);
                return;
            }
            match write_total_duration(&path, &state.config.frontmatter_key, duration) {
                Ok(()) => {
                    if let Some(note) = state.notes.iter_mut().find(|note| note.path == path) {
                        note.duration_ms = duration;
                    }
                    refresh_models(&ui, &state);
                    ui.set_edit_note_open(false);
                    set_status(&ui, "Čas poznámky byl upraven.", false);
                }
                Err(error) => set_status(&ui, format!("Úprava poznámky selhala: {error}"), true),
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_obsidian(move |visible_index| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let Some(note_index) = state.visible_notes.get(visible_index as usize).copied() else {
                return;
            };
            let note = &state.notes[note_index];
            let vault = if state.config.obsidian_vault.trim().is_empty() {
                state
                    .config
                    .vault_path
                    .as_deref()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    .unwrap_or("Vault")
            } else {
                state.config.obsidian_vault.as_str()
            };
            if let Err(error) = open_url(&obsidian_url(vault, &note.relative_path)) {
                set_status(&ui, format!("Obsidian nelze otevřít: {error}"), true);
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_pin(move |visible_index| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let Some(note_index) = state.visible_notes.get(visible_index as usize).copied() else {
                return;
            };
            let path = state.notes[note_index].path.to_string_lossy().into_owned();
            if let Some(index) = state
                .config
                .pinned_notes
                .iter()
                .position(|item| item == &path)
            {
                state.config.pinned_notes.remove(index);
            } else {
                state.config.pinned_notes.push(path);
            }
            state.apply_filter();
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Připnutí se nepodařilo uložit: {error}"), true);
            }
            refresh_note_model(&ui, &state);
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
            let note_estimate = state.notes[note_index].time_estimate_minutes;
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
            state.timers.push(NativeTimer::new(
                note_path,
                note_name,
                note_duration,
                note_estimate,
                color,
            ));
            state.remember_timer_order();
            if let Err(error) = state
                .config
                .save()
                .and_then(|()| state.config.save_profile())
            {
                set_status(&ui, format!("Pořadí časomír nelze uložit: {error}"), true);
            }
            state.checkpoint_timers();
            set_status(&ui, "Časomíra je připravená.", false);
            refresh_models(&ui, &state);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_set_timer_estimate(move |index, minutes| {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let estimate_key = state.config.time_estimate_key.clone();
            let language = state.config.language.clone();
            let row = state.timers.get_mut(index as usize).map(|timer| {
                timer.time_estimate_minutes = (minutes > 0).then_some(minutes as u64);
                (PathBuf::from(&timer.note_path), timer_row(timer, &language))
            });
            if let Some((path, row)) = row {
                if let Err(error) = write_time_estimate(&path, &estimate_key, minutes as u64) {
                    set_status(&ui, format!("Odhad se nepodařilo uložit: {error}"), true);
                    return;
                }
                if let Some(note) = state.notes.iter_mut().find(|note| note.path == path) {
                    note.time_estimate_minutes = (minutes > 0).then_some(minutes as u64);
                }
                state.timer_model.set_row_data(index as usize, row);
                refresh_grid_row(&state, index as usize);
                state.checkpoint_timers();
            }
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_timer(move |index| {
            let Some(_ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let language = state.config.language.clone();
            let row = state.timers.get_mut(index as usize).map(|timer| {
                timer.toggle();
                timer_row(timer, &language)
            });
            if let Some(row) = row {
                state.timer_model.set_row_data(index as usize, row);
                refresh_grid_row(&state, index as usize);
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
            let added = state
                .timers
                .get(index as usize)
                .map(NativeTimer::added_elapsed_ms)
                .unwrap_or(0);
            let operation_id = format!("native:{}:{}", path.to_string_lossy(), elapsed);
            let key = state.config.frontmatter_key.clone();
            match write_total_duration(&path, &key, elapsed) {
                Ok(()) => {
                    if let Err(error) =
                        append_activity(&state.config, added, &path, &name, &operation_id)
                    {
                        state.checkpoint_timers();
                        set_status(&ui, format!("Zápis aktivity selhal: {error}"), true);
                        return;
                    }
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

    let scan_result_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        scan_result_tick.start(TimerMode::Repeated, Duration::from_millis(40), move || {
            let Some(ui) = weak.upgrade() else { return };
            apply_async_scan_results(&ui, &state, &scan_receiver);
        });
    }

    let watcher_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let scan_sender = scan_sender.clone();
        let mut pending = false;
        let mut full_reconciliation = false;
        let mut changed_paths = std::collections::HashSet::new();
        let mut last_event = Instant::now();
        watcher_tick.start(TimerMode::Repeated, Duration::from_millis(100), move || {
            let Some(ui) = weak.upgrade() else { return };
            while let Ok(signal) = watch_receiver.try_recv() {
                pending = true;
                last_event = Instant::now();
                match signal {
                    WatchSignal::Paths(paths) => changed_paths.extend(paths),
                    WatchSignal::Reconcile => full_reconciliation = true,
                }
            }
            if pending
                && last_event.elapsed() >= Duration::from_millis(300)
                && !state.borrow().scan_in_progress
            {
                pending = false;
                if full_reconciliation {
                    full_reconciliation = false;
                    changed_paths.clear();
                    start_async_scan(&ui, &state, &scan_sender, "Index aktualizován");
                } else {
                    let paths = changed_paths.drain().collect();
                    start_async_path_refresh(
                        &ui,
                        &state,
                        &scan_sender,
                        "Index aktualizován",
                        paths,
                    );
                }
            }
        });
    }

    let timer_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let mut expiration_frame = 0_u8;
        let mut alerted = std::collections::HashSet::new();
        timer_tick.start(TimerMode::Repeated, Duration::from_millis(50), move || {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            let columns = state.layout_columns();
            let mut last_grid_row = None;
            for (index, timer) in state.timers.iter().enumerate() {
                if timer.is_running() {
                    state
                        .timer_model
                        .set_row_data(index, timer_row(timer, &state.config.language));
                    if columns > 1 {
                        let grid_row = index / columns;
                        if last_grid_row != Some(grid_row) {
                            refresh_grid_row(&state, index);
                            last_grid_row = Some(grid_row);
                        }
                    }
                }
            }
            expiration_frame = (expiration_frame + 1) % 20;
            if expiration_frame == 0 {
                for timer in state.timers.iter().filter(|timer| timer.is_running()) {
                    let expired = timer.time_estimate_minutes.is_some_and(|minutes| {
                        timer.current_elapsed_ms() >= minutes.saturating_mul(60_000)
                    });
                    if claim_expiration_once(
                        &mut alerted,
                        &timer.note_path,
                        state.config.timer_limit_alert.enabled,
                        expired,
                    ) {
                        let title = "Časový limit dosažen";
                        let message = if state.config.timer_limit_alert.custom_message.is_empty() {
                            format!("Odhad pro „{}“ byl vyčerpán.", timer.name)
                        } else {
                            state
                                .config
                                .timer_limit_alert
                                .custom_message
                                .replace("{{name}}", &timer.name)
                        };
                        if state.config.timer_limit_alert.notifications_enabled {
                            show_notification(title, &message);
                        }
                        if state.config.timer_limit_alert.show_overlay {
                            ui.set_expiration_overlay_title(title.into());
                            ui.set_expiration_overlay_message(message.clone().into());
                            ui.set_expiration_overlay_open(true);
                        }
                        if state.config.timer_limit_alert.sound_enabled
                            && let Some(path) = state.config.timer_limit_alert.sound_path.as_deref()
                            && let Err(error) = play_sound(path)
                        {
                            eprintln!("alert sound failed: {error}");
                        }
                    }
                }
            }
        });
    }

    let animation_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let last_sidebar_scroll = last_sidebar_scroll.clone();
        let mut phase = 0.0_f32;
        // Keep a stable native UI cadence. Driving a long Slint
        // property animation kept the software renderer repainting at display
        // refresh rate and starved sidebar scrolling on large windows.
        animation_tick.start(TimerMode::Repeated, Duration::from_millis(55), move || {
            let Some(ui) = weak.upgrade() else { return };
            if last_sidebar_scroll.get().elapsed() < Duration::from_millis(180) {
                return;
            }
            phase = (phase + 0.0044) % std::f32::consts::TAU;
            ui.set_glow_a_x(18.0 + phase.sin() * 9.0);
            ui.set_glow_a_y(24.0 + (phase * 0.7).cos() * 10.0);
            ui.set_glow_b_x(48.0 + (phase * 0.8).cos() * 10.0);
            ui.set_glow_b_y(66.0 + (phase * 0.55).sin() * 11.0);
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

    let maintenance_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let scan_sender = scan_sender.clone();
        let mut last_refresh = Instant::now();
        let mut last_notification = Instant::now();
        maintenance_tick.start(TimerMode::Repeated, Duration::from_secs(30), move || {
            let Some(ui) = weak.upgrade() else { return };
            let refresh_minutes = state.borrow().config.auto_refresh_interval;
            if refresh_minutes > 0
                && last_refresh.elapsed() >= Duration::from_secs(u64::from(refresh_minutes) * 60)
            {
                last_refresh = Instant::now();
                start_async_scan(&ui, &state, &scan_sender, "Automaticky obnoveno");
            }
            let state = state.borrow();
            let notification_minutes = state.config.notifications.interval_minutes;
            if state.config.notifications.enabled
                && notification_minutes > 0
                && state.timers.iter().any(NativeTimer::is_running)
                && last_notification.elapsed()
                    >= Duration::from_secs(u64::from(notification_minutes) * 60)
            {
                last_notification = Instant::now();
                show_notification("mmStopWatch běží", "Měření času stále pokračuje na pozadí.");
            }
        });
    }

    if let Ok(panel) = std::env::var("MMSTOPWATCH_PREVIEW_PANEL") {
        match panel.as_str() {
            "settings" => ui.invoke_open_settings(),
            "stats" => {
                ui.invoke_open_stats();
                if let Ok(tab) = std::env::var("MMSTOPWATCH_PREVIEW_STATS_TAB")
                    && let Ok(tab) = tab.parse::<i32>()
                {
                    ui.set_stats_tab(tab.clamp(0, 5));
                }
                if let Ok(profile) = std::env::var("MMSTOPWATCH_PREVIEW_STATS_PROFILE")
                    && let Ok(profile) = profile.parse::<i32>()
                {
                    ui.invoke_shift_stats_profile(
                        profile.clamp(0, ui.get_stats_profile_count() - 1)
                            - ui.get_stats_profile_index(),
                    );
                }
                if let Ok(offset) = std::env::var("MMSTOPWATCH_PREVIEW_STATS_MONTH")
                    && let Ok(offset) = offset.parse::<i32>()
                {
                    ui.invoke_shift_stats_calendar(offset.clamp(-120, 120));
                }
            }
            "new-note" => ui.set_new_note_open(true),
            "close-guard" => ui.set_close_guard_open(true),
            "onboarding" => ui.set_onboarding_visible(true),
            _ => {}
        }
    }

    let scroll_benchmark_tick = Rc::new(Timer::default());
    if let Some(note_count) = scroll_benchmark_count {
        let benchmark_tick = scroll_benchmark_tick.clone();
        let weak = ui.as_weak();
        let frame_count = 180_usize;
        let mut frame = 0_usize;
        let mut frame_intervals = Vec::with_capacity(frame_count.saturating_sub(1));
        let mut previous_frame = Instant::now();
        let benchmark_started = previous_frame;
        let max_scroll = ((note_count as f32 * 98.0) - 440.0).max(0.0);
        let last_sidebar_scroll = last_sidebar_scroll.clone();
        scroll_benchmark_tick.start(
            TimerMode::Repeated,
            Duration::from_millis(16),
            move || {
                let Some(ui) = weak.upgrade() else { return };
                let now = Instant::now();
                last_sidebar_scroll.set(now);
                if frame > 0 {
                    frame_intervals.push(now.duration_since(previous_frame));
                }
                previous_frame = now;
                let progress = frame as f32 / (frame_count.saturating_sub(1).max(1) as f32);
                let position = if progress <= 0.5 {
                    progress * 2.0
                } else {
                    (1.0 - progress) * 2.0
                };
                ui.set_notes_scroll_y(-max_scroll * position);
                frame += 1;
                if frame < frame_count {
                    return;
                }
                benchmark_tick.stop();
                frame_intervals.sort_unstable();
                let percentile = |percent: usize| {
                    frame_intervals[(frame_intervals.len() * percent / 100)
                        .min(frame_intervals.len().saturating_sub(1))]
                };
                eprintln!(
                    "scroll benchmark: {note_count} notes, model {:?}, frames {}, total {:?}, interval p50 {:?}, p95 {:?}, p99 {:?}, max {:?}",
                    scroll_fixture_elapsed,
                    frame_count,
                    benchmark_started.elapsed(),
                    percentile(50),
                    percentile(95),
                    percentile(99),
                    frame_intervals.last().copied().unwrap_or_default(),
                );
                let _ = slint::quit_event_loop();
            },
        );
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
