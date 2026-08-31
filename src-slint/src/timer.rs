use std::time::Instant;

#[derive(Clone, Debug)]
pub struct NativeTimer {
    pub note_path: String,
    pub name: String,
    pub elapsed_ms: u64,
    pub base_elapsed_ms: u64,
    pub time_estimate_minutes: Option<u64>,
    pub running_since: Option<Instant>,
    pub color: slint::Color,
}

impl NativeTimer {
    pub fn new(
        note_path: String,
        name: String,
        elapsed_ms: u64,
        time_estimate_minutes: Option<u64>,
        color: slint::Color,
    ) -> Self {
        Self {
            note_path,
            name,
            elapsed_ms,
            base_elapsed_ms: elapsed_ms,
            time_estimate_minutes,
            running_since: None,
            color,
        }
    }

    pub fn added_elapsed_ms(&self) -> u64 {
        self.current_elapsed_ms()
            .saturating_sub(self.base_elapsed_ms)
    }

    pub fn estimate_progress(&self) -> f32 {
        let Some(minutes) = self.time_estimate_minutes else {
            return 0.0;
        };
        if minutes == 0 {
            return 0.0;
        }
        (self.current_elapsed_ms() as f32 / (minutes as f32 * 60_000.0)).clamp(0.0, 1.0)
    }

    pub fn is_running(&self) -> bool {
        self.running_since.is_some()
    }

    pub fn current_elapsed_ms(&self) -> u64 {
        self.elapsed_ms.saturating_add(
            self.running_since
                .map(|started| started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
                .unwrap_or(0),
        )
    }

    pub fn toggle(&mut self) {
        if let Some(started) = self.running_since.take() {
            self.elapsed_ms = self
                .elapsed_ms
                .saturating_add(started.elapsed().as_millis() as u64);
        } else {
            self.running_since = Some(Instant::now());
        }
    }

    pub fn pause(&mut self) {
        if self.running_since.is_some() {
            self.toggle();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paused_timer_keeps_exact_elapsed_value() {
        let timer = NativeTimer::new(
            "a.md".into(),
            "A".into(),
            42_000,
            None,
            slint::Color::from_rgb_u8(255, 255, 255),
        );
        assert_eq!(timer.current_elapsed_ms(), 42_000);
        assert!(!timer.is_running());
    }
}
