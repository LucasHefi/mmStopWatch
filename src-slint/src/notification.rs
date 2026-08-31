use std::{collections::HashSet, io, path::Path, process::Command};

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
        let script = "display notification (system attribute \"MMST_MESSAGE\") with title (system attribute \"MMST_TITLE\")";
        let _ = Command::new("osascript")
            .env("MMST_TITLE", title)
            .env("MMST_MESSAGE", message)
            .args(["-e", script])
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let script = r#"$xml=New-Object Windows.Data.Xml.Dom.XmlDocument;$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>');$texts=$xml.GetElementsByTagName('text');$texts.Item(0).AppendChild($xml.CreateTextNode($env:MMST_TITLE))>$null;$texts.Item(1).AppendChild($xml.CreateTextNode($env:MMST_MESSAGE))>$null;[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('mmStopWatch').Show([Windows.UI.Notifications.ToastNotification]::new($xml))"#;
        let _ = Command::new("powershell")
            .env("MMST_TITLE", title)
            .env("MMST_MESSAGE", message)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .spawn();
    }
}

pub fn claim_expiration_once(
    alerted: &mut HashSet<String>,
    timer_key: &str,
    enabled: bool,
    expired: bool,
) -> bool {
    enabled && expired && alerted.insert(timer_key.to_owned())
}

pub fn play_sound(path: &Path) -> io::Result<()> {
    if !path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "zvukový soubor neexistuje",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        for player in ["pw-play", "paplay", "aplay"] {
            match Command::new(player).arg(path).spawn() {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "není dostupný přehrávač pw-play, paplay ani aplay",
        ))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("afplay").arg(path).spawn().map(|_| ())
    }
    #[cfg(target_os = "windows")]
    {
        let escaped = path.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$p=New-Object System.Media.SoundPlayer '{}';$p.Play()",
            escaped
        );
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .spawn()
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiration_alert_is_enabled_and_claimed_only_once() {
        let mut alerted = HashSet::new();
        assert!(!claim_expiration_once(&mut alerted, "a.md", false, true));
        assert!(!claim_expiration_once(&mut alerted, "a.md", true, false));
        assert!(claim_expiration_once(&mut alerted, "a.md", true, true));
        assert!(!claim_expiration_once(&mut alerted, "a.md", true, true));
        assert!(claim_expiration_once(&mut alerted, "b.md", true, true));
    }
}
