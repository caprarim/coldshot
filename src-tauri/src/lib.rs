mod capture;
mod files;
mod settings;
mod state;
mod update;

use state::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            capture::start_capture,
            capture::get_overlay_data,
            capture::finish_capture,
            capture::cancel_capture,
            capture::open_editor,
            files::get_history,
            files::load_capture,
            files::load_thumb,
            files::update_capture,
            files::delete_capture,
            files::reveal_capture,
            files::reveal_path,
            files::copy_image,
            files::quick_save,
            files::save_image_as,
            files::pick_folder,
            files::pin_image,
            files::get_pin_image,
            files::open_history,
            files::close_window,
            files::resize_window,
            settings::get_settings,
            settings::update_settings,
            update::update_check,
            update::update_download,
            update::update_install,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let loaded = settings::load_settings(&handle);
            {
                let state = app.state::<AppState>();
                *state.settings.lock().unwrap() = loaded.clone();
            }
            if let Err(e) = settings::register_hotkeys(&handle, &loaded, false) {
                eprintln!("hotkey registration failed: {e}");
            }

            let capture_area =
                MenuItem::with_id(app, "capture_area", "Capture Area", true, None::<&str>)?;
            let capture_window =
                MenuItem::with_id(app, "capture_window", "Capture Window", true, None::<&str>)?;
            let capture_full = MenuItem::with_id(
                app,
                "capture_full",
                "Capture Full Screen",
                true,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let open = MenuItem::with_id(app, "open", "Open ColdShot", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit ColdShot", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &capture_area,
                    &capture_window,
                    &capture_full,
                    &sep1,
                    &open,
                    &sep2,
                    &quit,
                ],
            )?;

            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ColdShot")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "capture_area" => capture::begin(app.clone(), "area", 0),
                    "capture_window" => capture::begin(app.clone(), "window", 0),
                    "capture_full" => capture::begin(app.clone(), "full", 0),
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } if label == "main" => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    if label == "overlay" {
                        capture::overlay_closed(window.app_handle());
                    } else if let Some(n) =
                        label.strip_prefix("pin-").and_then(|s| s.parse::<u32>().ok())
                    {
                        let state = window.app_handle().state::<AppState>();
                        state.pins.lock().unwrap().remove(&n);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ColdShot");
}
