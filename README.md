# ColdShot

Fast screenshot tool for Windows built with Tauri 2, React and Tailwind. Inspired by CleanShot X.

## Download

**[Download ColdShot for Windows (.exe)](https://github.com/caprarim/coldshot/releases/latest/download/ColdShot_0.2.1_x64-setup.exe)**

All versions are on the [releases page](https://github.com/caprarim/coldshot/releases).

Run the installer. It installs per user, so no admin prompt. The build is unsigned, so SmartScreen may warn: click "More info" then "Run anyway". ColdShot then lives in the system tray and the global hotkeys work right away.

## Features

- Area capture: drag to select, click to grab a whole window, crosshair guides, live size readout
- Window capture and full screen capture
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
  "version": "0.3.0",
  "url": "https://coldworkapp.com/downloads/ColdShot_0.3.0_x64-setup.exe",
  "notes": "What changed in this release"
}
```

`url` must be an https link to the NSIS setup exe. If it is missing, ColdShot falls back to
`https://coldworkapp.com/api/download?platform=coldshot-windows`. Publish that JSON plus the setup
exe after every `npx tauri build` and the in app Update button picks the release up.

## Dev

```
npm install
npx tauri dev
```

## Build

```
npx tauri build
```

Produces `ColdShot.exe` and an NSIS installer (per-user install). Windows only for now; macOS and Linux targets planned.

## Storage

- Captures and history: `%APPDATA%\com.coldwork.coldshot\captures`
- Settings: `%APPDATA%\com.coldwork.coldshot\settings.json`
- Default save folder: `Pictures\ColdShot`
