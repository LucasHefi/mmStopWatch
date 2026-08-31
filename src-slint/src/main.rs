mod activity;
mod app_state;
mod config;
mod integration;
mod notification;
mod report;
mod stats;
mod storage;
mod timer;

use activity::append_activity;
use app_state::{
    AppState, COLORS, note_rows, refresh_grid_row, refresh_models, set_status, sync_grid_model,
    timer_row,
};
use chrono::{Datelike, Local};
use config::AppConfig;
use integration::{obsidian_url, open_url};
use notification::{claim_expiration_once, play_sound, show as show_notification};
use report::save_report;
use slint::{CloseRequestResponse, Model, ModelRc, Timer, TimerMode};
use stats::snapshot as stats_snapshot;
use std::{
    cell::{Cell, RefCell},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    rc::Rc,
    time::{Duration, Instant},
};
use storage::{create_note, write_time_estimate, write_total_duration};
use timer::NativeTimer;

slint::include_modules!();

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
            .chunks_exact(7)
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

fn sync_settings(ui: &AppWindow, config: &AppConfig) {
    ui.set_settings_nick(config.nick.clone().unwrap_or_default().into());
    ui.set_settings_frontmatter(config.frontmatter_key.clone().into());
    ui.set_settings_estimate_key(config.time_estimate_key.clone().into());
    ui.set_settings_time_format(config.time_format.clone().into());
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

    config.nick = (!nick.is_empty()).then_some(nick);
    config.frontmatter_key = frontmatter;
    config.time_estimate_key = estimate_key;
    config.time_format = time_format;
    config.language = ui.get_settings_language().trim().to_owned();
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
    } else if let Some(vault) = config.vault_path.clone() {
        let _ = config.adopt_vault(vault);
    }
    if let Ok(columns) = std::env::var("MMSTOPWATCH_PREVIEW_COLUMNS")
        && let Ok(columns) = columns.parse::<usize>()
    {
        config.timer_layout.mode = format!("grid-{}", columns.clamp(1, 4));
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
    sync_settings(&ui, &config);
    ui.set_onboarding_visible(config.vault_path.is_none());
    ui.set_new_note_filename(Local::now().format("%Y-%m-%d.md").to_string().into());
    let preview_count = std::env::var("MMSTOPWATCH_PREVIEW_TIMERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_else(|| usize::from(std::env::var_os("MMSTOPWATCH_PREVIEW_TIMER").is_some()));
    let diagnostics = preview_count > 0;
    let state = Rc::new(RefCell::new(AppState::new(config, diagnostics)));
    ui.set_timers(ModelRc::from(state.borrow().timer_model.clone()));
    ui.set_timer_grid(ModelRc::from(state.borrow().timer_grid_model.clone()));

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

    if state.borrow().config.vault_path.is_some() {
        match state.borrow_mut().reload() {
            Ok(count) => set_status(&ui, format!("Načteno {count} poznámek"), false),
            Err(error) => set_status(&ui, error, true),
        }
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
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let calendar_offset = stats_calendar_offset.clone();
        ui.on_open_stats(move || {
            let Some(ui) = weak.upgrade() else { return };
            let snapshot = stats_snapshot(&state.borrow().config);
            calendar_offset.set(0);
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
            ui.set_stats_productivity(
                format_productivity_slope(snapshot.productivity_slope_ms).into(),
            );
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
                &ui,
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
            ui.set_stats_open(true);
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let calendar_offset = stats_calendar_offset;
        ui.on_shift_stats_calendar(move |delta| {
            let Some(ui) = weak.upgrade() else { return };
            let offset = calendar_offset.get().saturating_add(delta).clamp(-120, 120);
            calendar_offset.set(offset);
            set_stats_calendar(
                &ui,
                stats::calendar_snapshot(&state.borrow().config, offset),
            );
        });
    }

    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_export_report(move |monthly| {
            let Some(ui) = weak.upgrade() else { return };
            let state = state.borrow();
            match save_report(&state.config, &state.notes, if monthly { 30 } else { 7 }) {
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
            let row = state.timers.get_mut(index as usize).map(|timer| {
                timer.time_estimate_minutes = (minutes > 0).then_some(minutes as u64);
                (PathBuf::from(&timer.note_path), timer_row(timer))
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
            let row = state.timers.get_mut(index as usize).map(|timer| {
                timer.toggle();
                timer_row(timer)
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
                    state.timer_model.set_row_data(index, timer_row(timer));
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

    let maintenance_tick = Timer::default();
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let mut last_refresh = Instant::now();
        let mut last_notification = Instant::now();
        maintenance_tick.start(TimerMode::Repeated, Duration::from_secs(30), move || {
            let Some(ui) = weak.upgrade() else { return };
            let mut state = state.borrow_mut();
            let refresh_minutes = state.config.auto_refresh_interval;
            if refresh_minutes > 0
                && last_refresh.elapsed() >= Duration::from_secs(u64::from(refresh_minutes) * 60)
            {
                last_refresh = Instant::now();
                if state.reload().is_ok() {
                    refresh_models(&ui, &state);
                }
            }
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
                    ui.set_stats_tab(tab.clamp(0, 4));
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
