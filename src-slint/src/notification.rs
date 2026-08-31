use std::process::Command;

pub fn show(title: &str, message: &str) {
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("notify-send")
            .arg("--app-name=mmStopWatch")
            .arg(title)
            .arg(message)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("display notification {:?} with title {:?}", message, title);
        let _ = Command::new("osascript").arg("-e").arg(script).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (title, message);
    }
}
