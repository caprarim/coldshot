import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  Monitor,
  AppWindow,
  History,
  Settings as SettingsIcon,
  Timer,
  FolderOpen,
  Trash2,
  Copy,
  Pencil,
  Pin,
  RefreshCw,
  Download,
  CheckCircle2,
} from "lucide-react";
import { api, HistoryEntry, Settings, UpdateStatus } from "../lib/api";

type Tab = "capture" | "history" | "settings" | "update";

export default function MainWindow() {
  const [tab, setTab] = useState<Tab>("capture");
  const [delay, setDelay] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toast, setToast] = useState("");
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateStage, setUpdateStage] = useState<
    "idle" | "checking" | "downloading" | "ready" | "installing"
  >("idle");
  const [updateError, setUpdateError] = useState("");
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const checkedRef = useRef(false);
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  };

  const loadHistory = () =>
    api
      .getHistory()
      .then(setHistory)
      .catch((e) => showToast(`Could not load history: ${e}`));

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  useEffect(() => {
    const un = listen<string>("capture-saved", () => {
      if (tabRef.current === "history") loadHistory();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const un = listen("show-history", () => {
      setTab("history");
      loadHistory();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const un = listen<[number, number]>("update-progress", (e) =>
      setProgress({ received: e.payload[0], total: e.payload[1] })
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const checkUpdate = async (loud: boolean) => {
    setUpdateError("");
    setUpdateStage("checking");
    try {
      const status = await api.updateCheck();
      setUpdate(status);
      setUpdateStage("idle");
      if (!status.ok) {
        if (loud) setUpdateError(status.error);
        return;
      }
      if (loud && !status.update_available) showToast("ColdShot is up to date");
    } catch (e) {
      setUpdateStage("idle");
      if (loud) setUpdateError(String(e));
    }
  };

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    checkUpdate(false);
  }, []);

  const downloadUpdate = async () => {
    setUpdateError("");
    setProgress({ received: 0, total: 0 });
    setUpdateStage("downloading");
    try {
      await api.updateDownload();
      setUpdateStage("ready");
    } catch (e) {
      setUpdateStage("idle");
      setUpdateError(String(e));
    }
  };

  const installUpdate = async () => {
    setUpdateError("");
    setUpdateStage("installing");
    try {
      await api.updateInstall();
    } catch (e) {
      setUpdateStage("ready");
      setUpdateError(String(e));
    }
  };

  const capture = (mode: string) => {
    api.startCapture(mode, delay * 1000).catch((e) => showToast(String(e)));
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await api.updateSettings(settings);
      showToast("Settings saved");
    } catch (e) {
      showToast(String(e));
    }
  };

  const copyFromHistory = async (id: string) => {
    try {
      const data = await api.loadCapture(id);
      await api.copyImage(data);
      showToast("Copied to clipboard");
    } catch (e) {
      showToast(`Copy failed: ${e}`);
    }
  };

  const pinFromHistory = async (id: string) => {
    try {
      const data = await api.loadCapture(id);
      await api.pinImage(data);
    } catch (e) {
      showToast(`Pin failed: ${e}`);
    }
  };

  const removeFromHistory = async (id: string) => {
    try {
      await api.deleteCapture(id);
      await loadHistory();
    } catch (e) {
      showToast(`Delete failed: ${e}`);
    }
  };

  const captureButtons = [
    {
      mode: "area",
      icon: <Camera size={26} />,
      title: "Capture Area",
      desc: "Drag to select a region of the screen",
      key: settings?.hotkey_area,
    },
    {
      mode: "window",
      icon: <AppWindow size={26} />,
      title: "Capture Window",
      desc: "Click a window to capture it",
      key: settings?.hotkey_window,
    },
    {
      mode: "full",
      icon: <Monitor size={26} />,
      title: "Capture Full Screen",
      desc: "Grab the entire screen instantly",
      key: settings?.hotkey_full,
    },
  ];

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 font-bold text-white">
          <Camera size={17} />
        </div>
        <div className="shrink-0 text-lg font-semibold text-white">ColdShot</div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {(
            [
              ["capture", <Camera size={15} key="c" />, "Capture"],
              ["history", <History size={15} key="h" />, "History"],
              ["settings", <SettingsIcon size={15} key="s" />, "Settings"],
              ["update", <Download size={15} key="u" />, "Update"],
            ] as [Tab, React.ReactNode, string][]
          ).map(([t, icon, label]) => (
            <button
              key={t}
              title={label}
              onClick={() => setTab(t)}
              className={`relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm sm:px-3 ${
                tab === t
                  ? "bg-cyan-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
              {t === "update" && update?.update_available && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-cyan-400" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "capture" && (
          <div className="mx-auto max-w-xl space-y-3">
            {captureButtons.map((b) => (
              <button
                key={b.mode}
                onClick={() => capture(b.mode)}
                className="flex w-full items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-cyan-600 hover:bg-zinc-800"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-cyan-400">
                  {b.icon}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white">{b.title}</div>
                  <div className="text-sm text-zinc-400">{b.desc}</div>
                </div>
                {b.key && (
                  <div className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-400">
                    {b.key}
                  </div>
                )}
              </button>
            ))}
            <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <Timer size={20} className="text-cyan-400" />
              <div className="flex-1 text-sm text-zinc-300">Self timer</div>
              <div className="flex gap-1">
                {[0, 3, 5, 10].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDelay(d)}
                    className={`rounded-md px-3 py-1 text-sm ${
                      delay === d
                        ? "bg-cyan-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    {d === 0 ? "Off" : `${d}s`}
                  </button>
                ))}
              </div>
            </div>
            <p className="pt-2 text-center text-xs text-zinc-500">
              ColdShot stays in the system tray. Closing this window keeps it
              running.
            </p>
          </div>
        )}

        {tab === "history" && (
          <div>
            {history.length === 0 ? (
              <div className="pt-16 text-center text-zinc-500">
                No captures yet. Take a screenshot and it will show up here.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                  >
                    <div
                      className="relative aspect-video cursor-pointer bg-zinc-800"
                      onClick={() =>
                        api
                          .openEditor(h.id)
                          .catch((err) => showToast(`Could not open: ${err}`))
                      }
                    >
                      <img
                        src={h.thumb}
                        className="h-full w-full object-contain"
                        alt=""
                      />
                      <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/60 group-hover:flex">
                        <button
                          title="Edit"
                          className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-cyan-600"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          title="Copy"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyFromHistory(h.id);
                          }}
                          className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-cyan-600"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          title="Pin to screen"
                          onClick={(e) => {
                            e.stopPropagation();
                            pinFromHistory(h.id);
                          }}
                          className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-cyan-600"
                        >
                          <Pin size={15} />
                        </button>
                        <button
                          title="Show in folder"
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .revealCapture(h.id)
                              .catch((err) => showToast(String(err)));
                          }}
                          className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-cyan-600"
                        >
                          <FolderOpen size={15} />
                        </button>
                        <button
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromHistory(h.id);
                          }}
                          className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-400">
                      <span>{h.created}</span>
                      <span className="font-mono">
                        {h.width} x {h.height}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "settings" && settings && (
          <div className="mx-auto max-w-xl space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                Save folder
              </label>
              <div className="flex gap-2">
                <input
                  value={settings.save_dir}
                  onChange={(e) =>
                    setSettings({ ...settings, save_dir: e.target.value })
                  }
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
                />
                <button
                  onClick={async () => {
                    try {
                      const dir = await api.pickFolder();
                      if (dir) setSettings({ ...settings, save_dir: dir });
                    } catch (e) {
                      showToast(String(e));
                    }
                  }}
                  className="rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
                >
                  Browse
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2.5 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={settings.auto_copy}
                onChange={(e) =>
                  setSettings({ ...settings, auto_copy: e.target.checked })
                }
                className="h-4 w-4 accent-cyan-500"
              />
              Copy screenshot to clipboard right after capture
            </label>
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm font-medium text-zinc-300">
                Global hotkeys
              </div>
              {(
                [
                  ["hotkey_area", "Capture area"],
                  ["hotkey_window", "Capture window"],
                  ["hotkey_full", "Capture full screen"],
                ] as [keyof Settings, string][]
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <div className="w-40 shrink-0 text-sm text-zinc-400">
                    {label}
                  </div>
                  <input
                    value={settings[key] as string}
                    onChange={(e) =>
                      setSettings({ ...settings, [key]: e.target.value })
                    }
                    className="min-w-[9rem] flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-cyan-500"
                  />
                </div>
              ))}
              <p className="text-xs text-zinc-500">
                Examples: Ctrl+Shift+1, Ctrl+Alt+A, F9
              </p>
            </div>
            <button
              onClick={saveSettings}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Save Settings
            </button>
          </div>
        )}

        {tab === "update" && (
          <div className="mx-auto max-w-xl space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 ${
                    update?.update_available
                      ? "text-cyan-400"
                      : update?.ok
                        ? "text-emerald-400"
                        : "text-zinc-400"
                  }`}
                >
                  {update?.update_available || !update?.ok ? (
                    <Download size={22} />
                  ) : (
                    <CheckCircle2 size={22} />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white">
                    {!update
                      ? "Checking for updates"
                      : update.update_available
                        ? `Version ${update.latest} is available`
                        : update.ok
                          ? "ColdShot is up to date"
                          : "Could not check for updates"}
                  </div>
                  <div className="text-sm text-zinc-400">
                    Installed version {update?.current ?? "unknown"}
                  </div>
                </div>
                <button
                  onClick={() => checkUpdate(true)}
                  disabled={updateStage === "checking" || updateStage === "downloading"}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                >
                  <RefreshCw
                    size={14}
                    className={updateStage === "checking" ? "animate-spin" : ""}
                  />
                  Check
                </button>
              </div>

              {update?.notes && update.update_available && (
                <p className="mt-4 whitespace-pre-line border-t border-zinc-800 pt-4 text-sm text-zinc-400">
                  {update.notes}
                </p>
              )}

              {updateStage === "downloading" && (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-cyan-500 transition-all"
                      style={{
                        width: progress.total
                          ? `${Math.min(100, (progress.received / progress.total) * 100)}%`
                          : "10%",
                      }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">
                    Downloading {(progress.received / 1048576).toFixed(1)} MB
                    {progress.total
                      ? ` of ${(progress.total / 1048576).toFixed(1)} MB`
                      : ""}
                  </div>
                </div>
              )}

              {update?.update_available && updateStage !== "downloading" && (
                <button
                  onClick={updateStage === "ready" ? installUpdate : downloadUpdate}
                  disabled={updateStage === "installing"}
                  className="mt-4 w-full rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {updateStage === "ready"
                    ? "Install and restart"
                    : updateStage === "installing"
                      ? "Installing..."
                      : "Download update"}
                </button>
              )}

              {updateError && (
                <p className="mt-3 text-sm text-red-400">{updateError}</p>
              )}
            </div>
            <p className="text-center text-xs text-zinc-500">
              ColdShot closes while the update installs and reopens on its own.
            </p>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-100 shadow-xl">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
