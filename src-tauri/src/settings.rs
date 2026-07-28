use crate::capture;
use crate::state::{AppState, Settings};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let mut s: Settings = settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if s.save_dir.trim().is_empty() {
        if let Ok(pics) = app.path().picture_dir() {
            s.save_dir = pics.join("ColdShot").display().to_string();
        }
    }
    s
}

fn persist(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(s).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn key_token(low: &str) -> Result<String, String> {
    if low.len() == 1 {
        let c = low.chars().next().unwrap();
        if c.is_ascii_digit() {
            return Ok(format!("Digit{c}"));
        }
        if c.is_ascii_alphabetic() {
            return Ok(format!("Key{}", c.to_ascii_uppercase()));
        }
    }
    if let Some(rest) = low.strip_prefix('f') {
        if let Ok(n) = rest.parse::<u8>() {
            if (1..=24).contains(&n) {
                return Ok(format!("F{n}"));
            }
        }
    }
    let named = match low {
        "printscreen" | "prtsc" | "print" => "PrintScreen",
        "space" => "Space",
        "enter" | "return" => "Enter",
        "tab" => "Tab",
        "home" => "Home",
        "end" => "End",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "insert" => "Insert",
        "delete" => "Delete",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "backspace" => "Backspace",
        "escape" | "esc" => "Escape",
        _ => return Err(format!("Unknown key: {low}")),
    };
    Ok(named.into())
}

fn normalize_shortcut(input: &str) -> Result<String, String> {
    let parts: Vec<&str> = input
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return Err("Empty hotkey".into());
    }
    let mut mods: Vec<String> = Vec::new();
    let mut key = String::new();
    for (i, part) in parts.iter().enumerate() {
        let low = part.to_lowercase();
        let is_last = i == parts.len() - 1;
        let is_modifier = matches!(
            low.as_str(),
            "ctrl" | "control" | "shift" | "alt" | "win" | "super" | "cmd" | "meta"
        );
        let tok = match low.as_str() {
            "ctrl" | "control" => {
                if is_last {
                    return Err("Hotkey needs a key after the modifiers".into());
                }
                "ctrl".to_string()
            }
            "shift" => {
                if is_last {
                    return Err("Hotkey needs a key after the modifiers".into());
                }
                "shift".to_string()
            }
            "alt" => {
                if is_last {
                    return Err("Hotkey needs a key after the modifiers".into());
                }
                "alt".to_string()
            }
            "win" | "super" | "cmd" | "meta" => {
                if is_last {
                    return Err("Hotkey needs a key after the modifiers".into());
                }
                "super".to_string()
            }
            _ => {
                if !is_last {
                    return Err(format!("Unknown modifier: {part}"));
                }
                key_token(&low)?
            }
        };
        if is_modifier {
            if !mods.contains(&tok) {
                mods.push(tok);
            }
        } else {
            key = tok;
        }
    }
    if key.is_empty() {
        return Err("Hotkey needs a key after the modifiers".into());
    }
    mods.sort();
    mods.push(key);
    Ok(mods.join("+"))
}

pub fn parse_shortcut(input: &str) -> Result<Shortcut, String> {
    normalize_shortcut(input)?
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid hotkey {input}: {e}"))
}

pub fn register_hotkeys(app: &AppHandle, s: &Settings, strict: bool) -> Result<(), String> {
    let combos = [
        (s.hotkey_area.as_str(), "area"),
        (s.hotkey_window.as_str(), "window"),
        (s.hotkey_full.as_str(), "full"),
    ];

    let mut planned: Vec<(String, Shortcut, &str)> = Vec::new();
    for (keys, mode) in combos {
        let normalized = match normalize_shortcut(keys) {
            Ok(n) => n,
            Err(e) => {
                if strict {
                    return Err(e);
                }
                eprintln!("skipping hotkey {keys}: {e}");
                continue;
            }
        };
        if planned.iter().any(|(n, _, _)| n == &normalized) {
            if strict {
                return Err(format!("{keys} is assigned to two actions."));
            }
            continue;
        }
        match parse_shortcut(keys) {
            Ok(sc) => planned.push((normalized, sc, mode)),
            Err(e) => {
                if strict {
                    return Err(e);
                }
                eprintln!("skipping hotkey {keys}: {e}");
            }
        }
    }

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut failed: Vec<String> = Vec::new();
    for (_, shortcut, mode) in planned {
        let mode = mode.to_string();
        if let Err(e) = gs.on_shortcut(shortcut, move |app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                capture::begin(app.clone(), &mode, 0);
            }
        }) {
            failed.push(format!("{e}"));
        }
    }
    if !failed.is_empty() {
        let msg = format!(
            "Another app is already using that hotkey ({}).",
            failed.join("; ")
        );
        if strict {
            return Err(msg);
        }
        eprintln!("{msg}");
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap();
    s.clone()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    if let Err(e) = register_hotkeys(&app, &settings, true) {
        let old = {
            let state = app.state::<AppState>();
            let s = state.settings.lock().unwrap();
            s.clone()
        };
        let _ = register_hotkeys(&app, &old, false);
        return Err(e);
    }
    persist(&app, &settings)?;
    let state = app.state::<AppState>();
    *state.settings.lock().unwrap() = settings;
    Ok(())
}
