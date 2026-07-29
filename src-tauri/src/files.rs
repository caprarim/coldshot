use crate::state::{AppState, HistoryItem};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::ImageFormat;
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() < 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn captures_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("captures");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history.json"))
}

pub fn read_history(app: &AppHandle) -> Vec<HistoryItem> {
    history_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_history(app: &AppHandle, items: &[HistoryItem]) -> Result<(), String> {
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string(items).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn encode_png(img: &image::RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn make_thumb(img: &image::RgbaImage) -> image::RgbaImage {
    let (w, h) = (img.width(), img.height());
    if w > 380 {
        let th = ((h as f64 * 380.0 / w as f64).round() as u32).max(1);
        image::imageops::resize(img, 380, th, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    }
}

pub fn store_capture(app: &AppHandle, img: &image::RgbaImage) -> Result<String, String> {
    let now = chrono::Local::now();
    let id = format!(
        "{}-{:03}",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_millis() % 1000
    );
    let dir = captures_dir(app)?;
    fs::write(dir.join(format!("{id}.png")), encode_png(img)?)
        .map_err(|e| e.to_string())?;

    let (w, h) = (img.width(), img.height());
    fs::write(dir.join(format!("{id}_thumb.png")), encode_png(&make_thumb(img))?)
        .map_err(|e| e.to_string())?;

    let mut items = read_history(app);
    items.insert(
        0,
        HistoryItem {
            id: id.clone(),
            width: w,
            height: h,
            created: now.format("%Y-%m-%d %H:%M").to_string(),
        },
    );
    while items.len() > 100 {
        if let Some(old) = items.pop() {
            let _ = fs::remove_file(dir.join(format!("{}.png", old.id)));
            let _ = fs::remove_file(dir.join(format!("{}_thumb.png", old.id)));
        }
    }
    write_history(app, &items)?;
    Ok(id)
}

pub fn copy_rgba_to_clipboard(img: &image::RgbaImage) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: img.width() as usize,
        height: img.height() as usize,
        bytes: std::borrow::Cow::Borrowed(img.as_raw().as_slice()),
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn decode_data_url(data: &str) -> Result<Vec<u8>, String> {
    let raw = match data.find("base64,") {
        Some(i) => &data[i + 7..],
        None => data,
    };
    STANDARD.decode(raw.trim()).map_err(|e| e.to_string())
}

fn resolve_save_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let configured = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.save_dir.clone()
    };
    let dir = if configured.trim().is_empty() {
        app.path()
            .picture_dir()
            .map_err(|e| e.to_string())?
            .join("ColdShot")
    } else {
        PathBuf::from(configured)
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "ColdShot.png".into()
    } else if cleaned.to_lowercase().ends_with(".png") {
        cleaned
    } else {
        format!("{cleaned}.png")
    }
}

#[derive(Serialize)]
pub struct HistoryEntryOut {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub created: String,
    pub thumb: String,
}

#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<Vec<HistoryEntryOut>, String> {
    let dir = captures_dir(&app)?;
    let items = read_history(&app);
    let mut out = Vec::new();
    for item in items.into_iter().take(100) {
        let thumb_path = dir.join(format!("{}_thumb.png", item.id));
        let Ok(bytes) = fs::read(&thumb_path) else {
            continue;
        };
        out.push(HistoryEntryOut {
            id: item.id,
            width: item.width,
            height: item.height,
            created: item.created,
            thumb: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn load_capture(app: AppHandle, id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("Invalid id".into());
    }
    let path = captures_dir(&app)?.join(format!("{id}.png"));
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn load_thumb(app: AppHandle, id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("Invalid id".into());
    }
    let path = captures_dir(&app)?.join(format!("{id}_thumb.png"));
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn update_capture(app: AppHandle, id: String, data: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid id".into());
    }
    let dir = captures_dir(&app)?;
    let path = dir.join(format!("{id}.png"));
    if !path.exists() {
        return Ok(());
    }
    let bytes = decode_data_url(&data)?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    fs::write(
        dir.join(format!("{id}_thumb.png")),
        encode_png(&make_thumb(&img))?,
    )
    .map_err(|e| e.to_string())?;

    let mut items = read_history(&app);
    let mut changed = false;
    for item in items.iter_mut() {
        if item.id == id {
            item.width = img.width();
            item.height = img.height();
            changed = true;
        }
    }
    if changed {
        write_history(&app, &items)?;
    }
    let _ = app.emit("capture-saved", id);
    Ok(())
}

#[tauri::command]
pub async fn delete_capture(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid id".into());
    }
    let dir = captures_dir(&app)?;
    let _ = fs::remove_file(dir.join(format!("{id}.png")));
    let _ = fs::remove_file(dir.join(format!("{id}_thumb.png")));
    let items: Vec<HistoryItem> = read_history(&app)
        .into_iter()
        .filter(|i| i.id != id)
        .collect();
    write_history(&app, &items)
}

#[tauri::command]
pub async fn reveal_capture(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid id".into());
    }
    let path = captures_dir(&app)?.join(format!("{id}.png"));
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(PathBuf::from(path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_image(data: String) -> Result<(), String> {
    let bytes = decode_data_url(&data)?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    copy_rgba_to_clipboard(&img)
}

#[tauri::command]
pub async fn quick_save(app: AppHandle, data: String, name: String) -> Result<String, String> {
    let bytes = decode_data_url(&data)?;
    let dir = resolve_save_dir(&app)?;
    let path = dir.join(sanitize_name(&name));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn save_image_as(
    app: AppHandle,
    data: String,
    name: String,
) -> Result<Option<String>, String> {
    let bytes = decode_data_url(&data)?;
    let dialog = app
        .dialog()
        .file()
        .set_file_name(sanitize_name(&name))
        .add_filter("PNG image", &["png"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.display().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => Ok(Some(
            fp.into_path().map_err(|e| e.to_string())?.display().to_string(),
        )),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn pin_image(app: AppHandle, data: String) -> Result<(), String> {
    let bytes = decode_data_url(&data)?;
    let (w, h) = image::load_from_memory(&bytes)
        .map(|i| (i.width(), i.height()))
        .map_err(|e| e.to_string())?;
    let n = {
        let state = app.state::<AppState>();
        let mut seq = state.pin_seq.lock().unwrap();
        *seq += 1;
        let n = *seq;
        state.pins.lock().unwrap().insert(n, bytes);
        n
    };
    let (mon_w, mon_h, scale) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let s = m.scale_factor();
            (m.size().width as f64 / s, m.size().height as f64 / s, s)
        })
        .unwrap_or((1600.0, 900.0, 1.0));
    let mut lw = w as f64 / scale;
    let mut lh = h as f64 / scale;
    let max_w = mon_w * 0.55;
    let max_h = mon_h * 0.55;
    let ratio = (max_w / lw).min(max_h / lh).min(1.0);
    lw = (lw * ratio).max(120.0);
    lh = (lh * ratio).max(68.0);
    let cursor = app
        .cursor_position()
        .map(|p| (p.x / scale - lw / 2.0, p.y / scale - lh / 2.0))
        .unwrap_or((100.0, 100.0));
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = WebviewWindowBuilder::new(
            &app2,
            format!("pin-{n}"),
            WebviewUrl::App(format!("index.html?view=pin&pid={n}").into()),
        )
        .title("ColdShot Pin")
        .inner_size(lw, lh)
        .position(cursor.0.max(0.0), cursor.1.max(0.0))
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(false)
        .build();
    });
    Ok(())
}

#[tauri::command]
pub fn get_pin_image(app: AppHandle, pid: String) -> Result<String, String> {
    let n: u32 = pid.parse().map_err(|_| "Bad pin id".to_string())?;
    let state = app.state::<AppState>();
    let pins = state.pins.lock().unwrap();
    let bytes = pins.get(&n).ok_or("Pin not found")?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// Brings the main window up and asks the UI to land on the History tab.
#[tauri::command]
pub fn open_history(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit("show-history", ());
    Ok(())
}

#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.close().map_err(|e| e.to_string())?;
        if let Some(n) = label.strip_prefix("pin-").and_then(|s| s.parse::<u32>().ok()) {
            let state = app.state::<AppState>();
            state.pins.lock().unwrap().remove(&n);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resize_window(app: AppHandle, label: String, w: f64, h: f64) -> Result<(), String> {
    if !label.starts_with("pin-") {
        return Err("Not allowed".into());
    }
    if let Some(win) = app.get_webview_window(&label) {
        win.set_size(tauri::LogicalSize::new(w.clamp(80.0, 4000.0), h.clamp(45.0, 4000.0)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
