use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

const LATEST_URL: &str = "https://coldworkapp.com/downloads/coldshot-latest.json";
const FALLBACK_URL: &str = "https://coldworkapp.com/api/download?platform=coldshot-windows";
const DETACHED_NO_WINDOW: u32 = 0x0800_0008;

#[derive(Deserialize)]
struct Latest {
    version: String,
    url: Option<String>,
    notes: Option<String>,
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

fn installer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("ColdShot-Update-Setup.exe"))
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
    let url = latest.url.filter(|u| u.starts_with("https://")).unwrap_or_else(|| FALLBACK_URL.into());
    let dest = installer_path(app)?;
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

fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

#[tauri::command]
pub fn update_install(app: AppHandle) -> Result<(), String> {
    let setup = {
        let state = app.state::<AppState>();
        let guard = state.update_file.lock().unwrap();
        guard.clone()
    }
    .filter(|p| p.exists())
    .ok_or_else(|| "Download the update first.".to_string())?;

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

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        handle.exit(0);
    });
    Ok(())
}
