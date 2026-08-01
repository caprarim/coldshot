# ColdShot

Fast screenshot tool for Windows and Linux built with Tauri 2, React and Tailwind. Inspired by CleanShot X.

## Download

**[Windows installer (.exe)](https://github.com/caprarim/coldshot/releases/latest/download/ColdShot_0.4.0_x64-setup.exe)**

**[Ubuntu / Debian package (.deb)](https://github.com/caprarim/coldshot/releases/latest/download/ColdShot_0.4.0_amd64.deb)**

**[Portable Linux build (.AppImage)](https://github.com/caprarim/coldshot/releases/latest/download/ColdShot_0.4.0_amd64.AppImage)**

All versions are on the [releases page](https://github.com/caprarim/coldshot/releases).

### Windows

Run the installer. It installs per user, so no admin prompt. The build is unsigned, so SmartScreen may warn: click "More info" then "Run anyway". ColdShot then lives in the system tray and the global hotkeys work right away.

### Ubuntu

Built on Ubuntu 24.04 LTS, so it needs Ubuntu 24.04 or newer. The screen capture backend binds to
PipeWire 1.0, which 22.04 does not ship. Install the .deb with apt so dependencies come along:

```
sudo apt install ./ColdShot_0.4.0_amd64.deb
```

Then launch ColdShot from your app menu. To run the portable build instead:

```
chmod +x ColdShot_0.4.0_amd64.AppImage
./ColdShot_0.4.0_amd64.AppImage
```

If the tray icon does not appear on GNOME, install the AppIndicator extension:

```
sudo apt install gnome-shell-extension-appindicator
```

**Use an X11 session.** Wayland blocks the window list and absolute window placement that area capture, window capture and pinning rely on. Pick "Ubuntu on Xorg" at the login screen, or launch with `GDK_BACKEND=x11 coldshot`.

## Features

- Area capture: drag to select, click to grab a whole window, crosshair guides, live size readout
- Window capture and full screen capture
- Capture preview card: after every shot a small thumbnail slides into the bottom left corner with Full screen, Copy and Open history buttons, and fades out on its own after 5 seconds
- Self timer (3, 5, 10 seconds)
- Annotation editor: pen (selected by default), highlighter, line, arrow, rectangle, ellipse, text, pixelate, numbered counter badges, crop, undo/redo, color and size controls
- Beautify: gradient backgrounds, padding, rounded corners, drop shadow
- Pin screenshots as floating always-on-top windows (drag to move, scroll to resize, double click to close)
- Capture history with thumbnails (edit, copy, pin, reveal, delete)
- Copy to clipboard, quick save, save as dialog
- Global hotkeys (defaults: Ctrl+Shift+1 area, Ctrl+Shift+2 window, Ctrl+Shift+3 full screen), editable in Settings
- System tray app: closing the main window keeps it running in the tray
- Update tab: checks for a new version, downloads the installer with a progress bar, installs silently and reopens ColdShot

## Update endpoint

The Update tab reads `https://coldworkapp.com/downloads/coldshot-latest.json`:

```json
{
  "version": "0.4.0",
  "url": "https://coldworkapp.com/downloads/ColdShot_0.4.0_x64-setup.exe",
  "linux_url": "https://coldworkapp.com/downloads/ColdShot_0.4.0_amd64.AppImage",
  "notes": "What changed in this release"
}
```

Each platform reads its own key, so a Linux client never pulls the Windows installer. `url` is the
https link to the NSIS setup exe, `linux_url` the https link to the AppImage. When a key is missing
ColdShot falls back to `https://coldworkapp.com/api/download?platform=coldshot-windows` or
`?platform=coldshot-linux`. Publish that JSON plus the artifacts after every release and the in app
Update button picks it up.

On Windows the update runs the NSIS installer silently and reopens ColdShot. On Linux an AppImage
replaces itself in place and relaunches. A `.deb` in `linux_url` is handed to the system package
installer instead, and you reopen ColdShot yourself once it finishes. Users who installed the .deb
from a release should update with `sudo apt install ./ColdShot_<version>_amd64.deb`.

## Dev

```
npm install
npx tauri dev
```

## Build

```
npx tauri build
```

On Windows this produces `ColdShot.exe` plus a per-user NSIS installer. On Linux it produces a
`.deb` and an `.AppImage` under `src-tauri/target/release/bundle`. Bundle targets live in
`src-tauri/tauri.windows.conf.json` and `src-tauri/tauri.linux.conf.json`, which Tauri merges over
`tauri.conf.json` per platform.

Build dependencies on Ubuntu 24.04:

```
sudo apt install build-essential curl wget file pkg-config cmake \
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf \
  libayatana-appindicator3-dev \
  libxcb1-dev libxcb-randr0-dev libxcb-shm0-dev libxcb-xfixes0-dev \
  libdbus-1-dev libpipewire-0.3-dev libgbm-dev libdrm-dev clang libclang-dev
```

Releases are built by `.github/workflows/release.yml`, which runs the Ubuntu and Windows bundles on
every `v*` tag and attaches all three artifacts to the GitHub release.

## Storage

Windows:

- Captures and history: `%APPDATA%\com.coldwork.coldshot\captures`
- Settings: `%APPDATA%\com.coldwork.coldshot\settings.json`
- Default save folder: `Pictures\ColdShot`

Linux:

- Captures and history: `~/.local/share/com.coldwork.coldshot/captures`
- Settings: `~/.local/share/com.coldwork.coldshot/settings.json`
- Default save folder: `~/Pictures/ColdShot`
