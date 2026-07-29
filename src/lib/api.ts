import { invoke } from "@tauri-apps/api/core";

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

export interface OverlayData {
  image: string;
  windows: WinRect[];
  mode: string;
}

export interface HistoryEntry {
  id: string;
  width: number;
  height: number;
  created: string;
  thumb: string;
}

export interface Settings {
  save_dir: string;
  auto_copy: boolean;
  hotkey_area: string;
  hotkey_full: string;
  hotkey_window: string;
}

export interface UpdateStatus {
  ok: boolean;
  current: string;
  latest: string;
  update_available: boolean;
  notes: string;
  error: string;
}

export const api = {
  startCapture: (mode: string, delayMs: number) =>
    invoke<void>("start_capture", { mode, delayMs }),
  getOverlayData: () => invoke<OverlayData>("get_overlay_data"),
  finishCapture: (x: number, y: number, w: number, h: number) =>
    invoke<void>("finish_capture", { x, y, w, h }),
  cancelCapture: () => invoke<void>("cancel_capture"),
  loadCapture: (id: string) => invoke<string>("load_capture", { id }),
  loadThumb: (id: string) => invoke<string>("load_thumb", { id }),
  updateCapture: (id: string, data: string) =>
    invoke<void>("update_capture", { id, data }),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  deleteCapture: (id: string) => invoke<void>("delete_capture", { id }),
  revealCapture: (id: string) => invoke<void>("reveal_capture", { id }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  openEditor: (id: string) => invoke<void>("open_editor", { id }),
  copyImage: (data: string) => invoke<void>("copy_image", { data }),
  saveImageAs: (data: string, name: string) =>
    invoke<string | null>("save_image_as", { data, name }),
  quickSave: (data: string, name: string) =>
    invoke<string>("quick_save", { data, name }),
  pinImage: (data: string) => invoke<void>("pin_image", { data }),
  getPinImage: (pid: string) => invoke<string>("get_pin_image", { pid }),
  closeWindow: (label: string) => invoke<void>("close_window", { label }),
  resizeWindow: (label: string, w: number, h: number) =>
    invoke<void>("resize_window", { label, w, h }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) =>
    invoke<void>("update_settings", { settings }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  updateCheck: () => invoke<UpdateStatus>("update_check"),
  updateDownload: () => invoke<void>("update_download"),
  updateInstall: () => invoke<void>("update_install"),
};
