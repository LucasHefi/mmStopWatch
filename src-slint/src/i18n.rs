use std::{collections::HashMap, sync::OnceLock};

const EMBEDDED_CATALOGUES: &str = include_str!("../assets/i18n/translations.ts");

pub const LANGUAGES: [&str; 15] = [
    "cs", "en", "de", "pl", "it", "es", "zh", "ja", "ko", "fr", "ru", "pt", "nl", "sv", "ar",
];

#[derive(Debug, Default)]
pub struct Catalog {
    values: HashMap<String, HashMap<String, String>>,
}

impl Catalog {
    pub fn embedded() -> Self {
        Self::parse(EMBEDDED_CATALOGUES)
    }

    fn parse(source: &str) -> Self {
        let mut values: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut language: Option<String> = None;
        for line in source.lines() {
            let trimmed = line.trim();
            if line.starts_with("  ") && !line.starts_with("    ") && trimmed.ends_with(": {") {
                let candidate = trimmed.trim_end_matches(": {");
                language = LANGUAGES.contains(&candidate).then(|| candidate.to_owned());
                if let Some(language) = language.as_ref() {
                    values.entry(language.clone()).or_default();
                }
                continue;
            }
            if trimmed == "}," {
                language = None;
                continue;
            }
            let Some(language) = language.as_ref() else {
                continue;
            };
            let Some((key, raw_value)) = trimmed.split_once(':') else {
                continue;
            };
            if !key
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
            {
                continue;
            }
            let raw_value = raw_value.trim().trim_end_matches(',').trim();
            let Some(value) = decode_string(raw_value) else {
                continue;
            };
            values
                .entry(language.clone())
                .or_default()
                .insert(key.to_owned(), value);
        }
        Self { values }
    }

    pub fn get_ref<'a>(&'a self, language: &str, key: &'a str) -> &'a str {
        self.values
            .get(language)
            .and_then(|catalogue| catalogue.get(key))
            .or_else(|| {
                self.values
                    .get("en")
                    .and_then(|catalogue| catalogue.get(key))
            })
            .map(String::as_str)
            .unwrap_or(key)
    }

    pub fn get(&self, language: &str, key: &str) -> String {
        self.get_ref(language, key).to_owned()
    }

    pub fn supports(language: &str) -> bool {
        LANGUAGES.contains(&language)
    }
}

pub fn global() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(Catalog::embedded)
}

pub fn tr(language: &str, key: &str) -> String {
    global().get(language, key)
}

pub fn tr_ref<'a>(language: &str, key: &'a str) -> &'a str {
    global().get_ref(language, key)
}

fn decode_string(raw: &str) -> Option<String> {
    let quote = raw.chars().next()?;
    if !matches!(quote, '\'' | '"') || !raw.ends_with(quote) || raw.len() < 2 {
        return None;
    }
    let inner = &raw[1..raw.len() - 1];
    let mut decoded = String::with_capacity(inner.len());
    let mut characters = inner.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        match characters.next() {
            Some('n') => decoded.push('\n'),
            Some('r') => decoded.push('\r'),
            Some('t') => decoded.push('\t'),
            Some(next) => decoded.push(next),
            None => decoded.push('\\'),
        }
    }
    Some(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_all_existing_language_catalogues() {
        let catalog = Catalog::embedded();
        for language in LANGUAGES {
            assert_ne!(catalog.get(language, "settings"), "settings");
            assert_ne!(catalog.get(language, "save"), "save");
            assert_ne!(catalog.get(language, "statistics"), "statistics");
        }
        assert_eq!(catalog.get("cs", "settings"), "Nastavení");
        assert_eq!(catalog.get("en", "settings"), "Settings");
    }
}
