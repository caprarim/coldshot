use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::process::Stdio;

const LATEST_URL: &str = "https://coldworkapp.com/downloads/coldshot-latest.json";

#[cfg(windows)]
const FALLBACK_URL: &str = "https://coldworkapp.com/api/download?platform=coldshot-windows";
#[cfg(target_os = "linux")]
const FALLBACK_URL: &str = "https://coldworkapp.com/api/download?platform=coldshot-linux";

#[cfg(windows)]
const DETACHED_NO_WINDOW: u32 = 0x0800_0008;

#[derive(Deserialize)]
struct Latest {
    version: String,
    #[serde(default)]
    #[allow(dead_code)]
    url: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    linux_url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

impl Latest {
    fn platform_url(&self) -> Option<String> {
        #[cfg(windows)]
        {
            self.url.clone()
        }
        #[cfg(target_os = "linux")]
        {
            self.linux_url.clone()
        }
    }
}

#[derive(Serialize)]
pub struct UpdateStatus {
    pub ok: bool,
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    pub notes: String,
    pub error: String,
}

fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |v: &str| -> Vec<u64> {
        v.trim()
            .trim_start_matches('v')
            .split('.')
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..pa.len().max(pb.len()) {
        let ord = pa.get(i).copied().unwrap_or(0).cmp(&pb.get(i).copied().unwrap_or(0));
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

fn valid_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() < 32
        && v.chars().all(|c| c.is_ascii_digit() || c == '.')
        && v.chars().next().is_some_and(|c| c.is_ascii_digit())
}

async fn fetch_latest() -> Result<Latest, String> {
    let url = format!(
        "{LATEST_URL}?t={}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let res = reqwest::Client::builder()
        .user_agent("ColdShot")
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|_| "Could not reach the update server.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Update server returned {}", res.status().as_u16()));
    }
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    let latest: Latest =
        serde_json::from_slice(&body).map_err(|_| "Bad update manifest.".to_string())?;
    if !valid_version(&latest.version) {
        return Err("Bad version format.".into());
    }
    Ok(latest)
}

fn artifact_name(url: &str) -> &'static str {
    #[cfg(windows)]
    {
        let _ = url;
        "ColdShot-Update-Setup.exe"
    }
    #[cfg(target_os = "linux")]
    {
        let clean = url
            .split(['?', '#'])
            .next()
            .unwrap_or(url)
            .to_ascii_lowercase();
        if clean.ends_with(".deb") {
            "ColdShot-Update.deb"
        } else {
            "ColdShot-Update.AppImage"
        }
    }
}

fn installer_path(app: &AppHandle, url: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join(artifact_name(url)))
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    match fetch_latest().await {
        Ok(latest) => Ok(UpdateStatus {
            ok: true,
            update_available: compare_versions(&latest.version, &current) == Ordering::Greater,
            latest: latest.version,
            notes: latest.notes.unwrap_or_default(),
            error: String::new(),
            current,
        }),
        Err(e) => Ok(UpdateStatus {
            ok: false,
            update_available: false,
            latest: String::new(),
            notes: String::new(),
            error: e,
            current,
        }),
    }
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let mut busy = state.update_busy.lock().unwrap();
        if *busy {
            return Err("An update is already downloading.".into());
        }
        *busy = true;
    }
    let result = download_inner(&app).await;
    {
        let state = app.state::<AppState>();
        *state.update_busy.lock().unwrap() = false;
    }
    result
}

async fn download_inner(app: &AppHandle) -> Result<(), String> {
    let latest = fetch_latest().await?;
    let url = latest
        .platform_url()
        .filter(|u| u.starts_with("https://"))
        .unwrap_or_else(|| FALLBACK_URL.into());
    let dest = installer_path(app, &url)?;
    let mut res = reqwest::Client::builder()
        .user_agent("ColdShot")
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|_| "Download failed. Try again.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({}).", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut last_sent = std::time::Instant::now();
    let mut buf: Vec<u8> = Vec::with_capacity(total.min(64 * 1024 * 1024) as usize);
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        received += chunk.len() as u64;
        buf.extend_from_slice(&chunk);
        if last_sent.elapsed().as_millis() > 200 {
            last_sent = std::time::Instant::now();
            let _ = app.emit("update-progress", (received, total));
        }
    }
    if received < 1024 * 1024 {
        return Err("Download incomplete. Try again.".into());
    }
    fs::write(&dest, &buf).map_err(|e| e.to_string())?;
    let _ = app.emit("update-progress", (received, received));
    *app.state::<AppState>().update_file.lock().unwrap() = Some(dest);
    Ok(())
}

fn downloaded_artifact(app: &AppHandle) -> Result<PathBuf, String> {
    {
        let state = app.state::<AppState>();
        let guard = state.update_file.lock().unwrap();
        guard.clone()
    }
    .filter(|p| p.exists())
    .ok_or_else(|| "Download the update first.".to_string())
}

fn quit_after_handoff(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        handle.exit(0);
    });
}

#[cfg(windows)]
fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

#[cfg(windows)]
#[tauri::command]
pub fn update_install(app: AppHandle) -> Result<(), String> {
    let setup = downloaded_artifact(&app)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("coldshot-apply-update.ps1");
    let body = [
        format!("$WaitPid = {}", std::process::id()),
        format!("$Setup = '{}'", ps_quote(&setup.display().to_string())),
        format!("$Exe = '{}'", ps_quote(&exe.display().to_string())),
        "try { Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction SilentlyContinue } catch {}".into(),
        "Start-Sleep -Milliseconds 800".into(),
        "Start-Process -FilePath $Setup -ArgumentList '/S' -Wait".into(),
        "Start-Sleep -Milliseconds 500".into(),
        "Start-Process -FilePath $Exe".into(),
        "Remove-Item -LiteralPath $Setup -Force -ErrorAction SilentlyContinue".into(),
        "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue".into(),
    ]
    .join("\r\n");
    fs::write(&script, body).map_err(|e| e.to_string())?;

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script.display().to_string(),
        ])
        .creation_flags(DETACHED_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;

    quit_after_handoff(&app);
    Ok(())
}

#[cfg(target_os = "linux")]
fn sh_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[cfg(target_os = "linux")]
fn writable(path: &Path) -> bool {
    fs::OpenOptions::new().append(true).open(path).is_ok()
}

#[cfg(target_os = "linux")]
fn self_update_target() -> Option<PathBuf> {
    if let Some(img) = std::env::var_os("APPIMAGE") {
        let p = PathBuf::from(img);
        return if writable(&p) { Some(p) } else { None };
    }
    let exe = std::env::current_exe().ok()?;
    if writable(&exe) {
        Some(exe)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn spawn_detached(script: &Path) -> Result<(), String> {
    Command::new("sh")
        .arg("-c")
        .arg(format!(
            "nohup sh '{}' >/dev/null 2>&1 &",
            sh_quote(&script.display().to_string())
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn update_install(app: AppHandle) -> Result<(), String> {
    let artifact = downloaded_artifact(&app)?;
    let is_appimage = artifact
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("appimage"))
        .unwrap_or(false);

    let target = if is_appimage { self_update_target() } else { None };

    let Some(target) = target else {
        Command::new("xdg-open")
            .arg(&artifact)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| {
                format!(
                    "Could not open the package. Install it yourself from {}",
                    artifact.display()
                )
            })?;
        return Ok(());
    };

    let script = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("coldshot-apply-update.sh");
    let body = [
        "#!/bin/sh".to_string(),
        format!("WAIT_PID={}", std::process::id()),
        format!("SRC='{}'", sh_quote(&artifact.display().to_string())),
        format!("DST='{}'", sh_quote(&target.display().to_string())),
        format!("SELF='{}'", sh_quote(&script.display().to_string())),
        "i=0".into(),
        "while kill -0 \"$WAIT_PID\" 2>/dev/null && [ \"$i\" -lt 150 ]; do".into(),
        "  sleep 0.2".into(),
        "  i=$((i+1))".into(),
        "done".into(),
        "sleep 1".into(),
        "cp -f \"$SRC\" \"$DST\" || exit 1".into(),
        "chmod 755 \"$DST\"".into(),
        "rm -f \"$SRC\"".into(),
        "(setsid \"$DST\" >/dev/null 2>&1 &) || \"$DST\" >/dev/null 2>&1 &".into(),
        "rm -f \"$SELF\"".into(),
    ]
    .join("\n");
    fs::write(&script, body).map_err(|e| e.to_string())?;

    spawn_detached(&script)?;
    quit_after_handoff(&app);
    Ok(())
}
