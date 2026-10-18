use crate::capture;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once, OnceLock};
use tauri::AppHandle;
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

const VK_S: u32 = 0x53;
const VK_MASK: u16 = 0xE8;

static APP: OnceLock<AppHandle> = OnceLock::new();
static MODE: Mutex<Option<String>> = Mutex::new(None);
static HELD: AtomicBool = AtomicBool::new(false);
static START: Once = Once::new();

pub fn set(app: &AppHandle, mode: Option<String>) {
    let _ = APP.set(app.clone());
    let wanted = mode.is_some();
    *MODE.lock().unwrap() = mode;
    if wanted {
        START.call_once(|| {
            std::thread::spawn(run_hook);
        });
    }
}

fn run_hook() {
    unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0);
        if hook.is_null() {
            eprintln!("Win+Shift+S hook failed to install");
            return;
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}
    }
}

fn down(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

fn send_mask() {
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MASK,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key(0), key(KEYEVENTF_KEYUP)];
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        if info.vkCode == VK_S && info.flags & LLKHF_INJECTED == 0 {
            let msg = wparam as u32;
            if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                if HELD.swap(false, Ordering::SeqCst) {
                    return 1;
                }
            } else if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                if HELD.load(Ordering::SeqCst) {
                    return 1;
                }
                let combo = (down(VK_LWIN) || down(VK_RWIN))
                    && down(VK_SHIFT)
                    && !down(VK_CONTROL)
                    && !down(VK_MENU);
                if combo {
                    let mode = MODE.lock().ok().and_then(|m| m.clone());
                    if let (Some(mode), Some(app)) = (mode, APP.get()) {
                        HELD.store(true, Ordering::SeqCst);
                        send_mask();
                        capture::begin(app.clone(), &mode, 0);
                        return 1;
                    }
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}
