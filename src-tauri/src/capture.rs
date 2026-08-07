use crate::files;
use crate::state::{AppState, Frozen, WinRect};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::ImageFormat;
use serde::Serialize;
use std::io::Cursor;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct OverlayData {
    pub image: String,
    pub windows: Vec<WinRect>,
    pub mode: String,
}

fn hide_main_for_capture(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let _ = w.hide();
    *app.state::<AppState>().main_hidden.lock().unwrap() = true;
    std::thread::sleep(std::time::Duration::from_millis(170));
}

fn take_main_hidden(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let mut flag = state.main_hidden.lock().unwrap();
    std::mem::replace(&mut *flag, false)
}

pub fn restore_main(app: &AppHandle) {
    if take_main_hidden(app) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

pub fn begin(app: AppHandle, mode: &str, delay_ms: u64) {
    let mode = mode.to_string();
    std::thread::spawn(move || {
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
        if app.get_webview_window("overlay").is_some() {
            return;
        }
        hide_main_for_capture(&app);
        match freeze(&app, &mode) {
            Ok(()) => {
                if mode == "full" {
                    let (w, h) = {
                        let state = app.state::<AppState>();
                        let guard = state.frozen.lock().unwrap();
                        match guard.as_ref() {
                            Some(f) => (f.mon_w as f64, f.mon_h as f64),
                            None => {
                                restore_main(&app);
                                return;
                            }
                        }
                    };
                    finalize(&app, 0.0, 0.0, w, h);
                } else {
                    create_overlay(&app);
                }
            }
            Err(e) => {
                eprintln!("capture failed: {e}");
                *app.state::<AppState>().frozen.lock().unwrap() = None;
                restore_main(&app);
            }
        }
    });
}

#[cfg(windows)]
fn is_shell_window(title: &str) -> bool {
    title == "Program Manager"
}

#[cfg(target_os = "linux")]
fn is_shell_window(title: &str) -> bool {
    matches!(
        title,
        "Desktop"
            | "desktop_window"
            | "gnome-shell"
            | "xfdesktop"
            | "Plasma"
            | "plasmashell"
            | "Docky"
            | "plank"
    )
}

/// Wayland and some multi head setups refuse a point lookup, so fall back to
/// the primary monitor instead of failing the whole capture.
fn monitor_at(x: i32, y: i32) -> Result<xcap::Monitor, String> {
    if let Ok(m) = xcap::Monitor::from_point(x, y) {
        return Ok(m);
    }
    let all = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let mut fallback = None;
    for m in all {
        if m.is_primary().unwrap_or(false) {
            return Ok(m);
        }
        if fallback.is_none() {
            fallback = Some(m);
        }
    }
    fallback.ok_or_else(|| "No monitor available to capture.".to_string())
}

fn freeze(app: &AppHandle, mode: &str) -> Result<(), String> {
    let pos = app
        .cursor_position()
        .map(|p| (p.x as i32, p.y as i32))
        .unwrap_or((0, 0));
    let monitor = monitor_at(pos.0, pos.1)?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    let scale = monitor
        .scale_factor()
        .map(|v| v as f64)
        .ok()
        .filter(|v| *v > 0.1)
        .unwrap_or(1.0);
    let mon_x = monitor.x().unwrap_or(0);
    let mon_y = monitor.y().unwrap_or(0);
    let mon_w = img.width();
    let mon_h = img.height();

    let own_pid = std::process::id();
    let mut windows = Vec::new();
    if mode != "full" {
        if let Ok(all) = xcap::Window::all() {
            for w in all {
                if w.pid().map(|p| p == own_pid).unwrap_or(false) {
                    continue;
                }
                let minimized = w.is_minimized().unwrap_or(true);
                let title = w.title().unwrap_or_default();
                if minimized || title.is_empty() || is_shell_window(&title) {
                    continue;
                }
                let wx = w.x().unwrap_or(0);
                let wy = w.y().unwrap_or(0);
                let ww = w.width().unwrap_or(0) as i32;
                let wh = w.height().unwrap_or(0) as i32;
                if ww < 40 || wh < 40 {
                    continue;
                }
                let x1 = wx.max(mon_x);
                let y1 = wy.max(mon_y);
                let x2 = (wx + ww).min(mon_x + mon_w as i32);
                let y2 = (wy + wh).min(mon_y + mon_h as i32);
                if x2 - x1 < 40 || y2 - y1 < 40 {
                    continue;
                }
                windows.push(WinRect {
                    x: (x1 - mon_x) as f64 / scale,
                    y: (y1 - mon_y) as f64 / scale,
                    w: (x2 - x1) as f64 / scale,
                    h: (y2 - y1) as f64 / scale,
                    title,
                });
            }
        }
    }

    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    *state.frozen.lock().unwrap() = Some(Frozen {
        img,
        png,
        scale,
        mon_x,
        mon_y,
        mon_w,
        mon_h,
        windows,
        mode: mode.to_string(),
    });
    Ok(())
}

fn create_overlay(app: &AppHandle) {
    let (mx, my, pw, ph) = {
        let state = app.state::<AppState>();
        let guard = state.frozen.lock().unwrap();
        match guard.as_ref() {
            Some(f) => (f.mon_x, f.mon_y, f.mon_w, f.mon_h),
            None => {
                restore_main(app);
                return;
            }
        }
    };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let builder = WebviewWindowBuilder::new(
            &app2,
            "overlay",
            WebviewUrl::App("index.html?view=overlay".into()),
        )
        .title("ColdShot Capture")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false);
        match builder.build() {
            Ok(w) => {
                let _ = w.set_position(tauri::PhysicalPosition::new(mx, my));
                let _ = w.set_size(tauri::PhysicalSize::new(pw, ph));
                let _ = w.show();
                let _ = w.set_focus();
            }
            Err(e) => {
                eprintln!("overlay failed: {e}");
                *app2.state::<AppState>().frozen.lock().unwrap() = None;
                restore_main(&app2);
            }
        }
    });
}

fn close_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
}

pub fn overlay_closed(app: &AppHandle) {
    let stale = {
        let state = app.state::<AppState>();
        let mut guard = state.frozen.lock().unwrap();
        guard.take().is_some()
    };
    if stale {
        restore_main(app);
    }
}

pub fn finalize(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) {
    let frozen = {
        let state = app.state::<AppState>();
        let taken = state.frozen.lock().unwrap().take();
        taken
    };
    let Some(frozen) = frozen else { return };
    finalize_frozen(app, frozen, x, y, w, h);
}

fn finalize_frozen(app: &AppHandle, frozen: Frozen, x: f64, y: f64, w: f64, h: f64) {
    let px = x.max(0.0).round() as u32;
    let py = y.max(0.0).round() as u32;
    let pw = (w.round() as u32).min(frozen.mon_w.saturating_sub(px));
    let ph = (h.round() as u32).min(frozen.mon_h.saturating_sub(py));
    if pw < 2 || ph < 2 {
        restore_main(app);
        return;
    }
    let cropped = image::imageops::crop_imm(&frozen.img, px, py, pw, ph).to_image();
    match files::store_capture(app, &cropped) {
        Ok(id) => {
            let auto_copy = {
                let state = app.state::<AppState>();
                let s = state.settings.lock().unwrap();
                s.auto_copy
            };
            if auto_copy {
                let _ = files::copy_rgba_to_clipboard(&cropped);
            }
            take_main_hidden(app);
            let _ = app.emit("capture-saved", id.clone());
            open_preview_window(app, &id, frozen.mon_x, frozen.mon_y, frozen.mon_h, frozen.scale);
        }
        Err(e) => {
            eprintln!("store failed: {e}");
            restore_main(app);
        }
    }
}

const PREVIEW_W: f64 = 276.0;
const PREVIEW_H: f64 = 250.0;
const PREVIEW_MARGIN: f64 = 20.0;
/// Rough room left for the Windows taskbar so the card floats above it.
const TASKBAR_ALLOWANCE: f64 = 56.0;

/// Drops a small capture card in the bottom-left corner of the monitor that was
/// captured, so a screenshot never steals focus with a full editor window.
pub fn open_preview_window(
    app: &AppHandle,
    id: &str,
    mon_x: i32,
    mon_y: i32,
    mon_h: u32,
    scale: f64,
) {
    if let Some(w) = app.get_webview_window("preview") {
        let _ = w.close();
        std::thread::sleep(std::time::Duration::from_millis(140));
    }
    let url = format!("index.html?view=preview&id={id}");
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let builder = WebviewWindowBuilder::new(&app2, "preview", WebviewUrl::App(url.into()))
            .title("ColdShot Preview")
            .inner_size(PREVIEW_W, PREVIEW_H)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .shadow(false)
            .focused(false)
            .visible(false);
        match builder.build() {
            Ok(w) => {
                let x = mon_x + (PREVIEW_MARGIN * scale).round() as i32;
                let y = mon_y + mon_h as i32
                    - ((PREVIEW_H + PREVIEW_MARGIN + TASKBAR_ALLOWANCE) * scale).round() as i32;
                let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                let _ = w.show();
            }
            Err(e) => eprintln!("preview failed: {e}"),
        }
    });
}

pub fn open_editor_window(app: &AppHandle, id: &str, img_w: u32, img_h: u32, scale: f64) {
    let label = format!("editor-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let (mon_w, mon_h) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let s = m.scale_factor();
            (
                m.size().width as f64 / s,
                m.size().height as f64 / s,
            )
        })
        .unwrap_or((1600.0, 900.0));
    let lw = (img_w as f64 / scale + 48.0)
        .clamp(640.0, mon_w * 0.92);
    let lh = (img_h as f64 / scale + 140.0)
        .clamp(480.0, mon_h * 0.92);
    let url = format!("index.html?view=editor&id={id}");
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = WebviewWindowBuilder::new(&app2, &label, WebviewUrl::App(url.into()))
            .title("ColdShot Editor")
            .inner_size(lw, lh)
            .min_inner_size(460.0, 400.0)
            .center()
            .build();
    });
}

#[tauri::command]
pub fn start_capture(app: AppHandle, mode: String, delay_ms: u64) -> Result<(), String> {
    if !["area", "window", "full"].contains(&mode.as_str()) {
        return Err("Unknown capture mode".into());
    }
    begin(app, &mode, delay_ms.min(60_000));
    Ok(())
}

#[tauri::command]
pub async fn get_overlay_data(app: AppHandle) -> Result<OverlayData, String> {
    let state = app.state::<AppState>();
    let guard = state.frozen.lock().unwrap();
    let f = guard.as_ref().ok_or("No active capture")?;
    Ok(OverlayData {
        image: format!("data:image/png;base64,{}", STANDARD.encode(&f.png)),
        windows: f.windows.clone(),
        mode: f.mode.clone(),
    })
}

#[tauri::command]
pub fn finish_capture(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let frozen = {
        let state = app.state::<AppState>();
        let taken = state.frozen.lock().unwrap().take();
        taken.ok_or("No active capture")?
    };
    let scale = frozen.scale;
    close_overlay(&app);
    std::thread::spawn(move || {
        finalize_frozen(&app, frozen, x * scale, y * scale, w * scale, h * scale);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) {
    {
        let state = app.state::<AppState>();
        *state.frozen.lock().unwrap() = None;
    }
    close_overlay(&app);
    restore_main(&app);
}

#[tauri::command]
pub async fn open_editor(app: AppHandle, id: String) -> Result<(), String> {
    if !files::valid_id(&id) {
        return Err("Invalid id".into());
    }
    let path = files::captures_dir(&app)?.join(format!("{id}.png"));
    let (w, h) = image::image_dimensions(&path).map_err(|e| e.to_string())?;
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    open_editor_window(&app, &id, w, h, scale);
    Ok(())
}
