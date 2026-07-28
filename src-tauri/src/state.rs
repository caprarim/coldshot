use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct WinRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub title: String,
}

pub struct Frozen {
    pub img: image::RgbaImage,
    pub png: Vec<u8>,
    pub scale: f64,
    pub mon_x: i32,
    pub mon_y: i32,
    pub mon_w: u32,
    pub mon_h: u32,
    pub windows: Vec<WinRect>,
    pub mode: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    pub save_dir: String,
    pub auto_copy: bool,
    pub hotkey_area: String,
    pub hotkey_full: String,
    pub hotkey_window: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            save_dir: String::new(),
            auto_copy: true,
            hotkey_area: "Ctrl+Shift+1".into(),
            hotkey_window: "Ctrl+Shift+2".into(),
            hotkey_full: "Ctrl+Shift+3".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub created: String,
}

#[derive(Default)]
pub struct AppState {
    pub frozen: Mutex<Option<Frozen>>,
    pub pins: Mutex<HashMap<u32, Vec<u8>>>,
    pub pin_seq: Mutex<u32>,
    pub settings: Mutex<Settings>,
    pub update_file: Mutex<Option<std::path::PathBuf>>,
    pub update_busy: Mutex<bool>,
    pub main_hidden: Mutex<bool>,
}
