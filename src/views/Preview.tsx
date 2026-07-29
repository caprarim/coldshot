import { useEffect, useRef, useState } from "react";
import { Copy, Maximize2, X, Check } from "lucide-react";
import { api } from "../lib/api";

const DISMISS_MS = 5000;
const TICK_MS = 100;

export default function Preview({ id }: { id: string }) {
  const [src, setSrc] = useState("");
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [remaining, setRemaining] = useState(DISMISS_MS);
  const holdRef = useRef(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    api.loadThumb(id).catch(() => api.loadCapture(id)).then(setSrc).catch(() => {});
  }, [id]);

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => {
      api.closeWindow("preview").catch(() => {});
    }, 160);
  };

  // Auto dismiss after 5s. Hovering the card holds the timer so the buttons
  // stay reachable instead of vanishing mid-click.
  useEffect(() => {
    let elapsed = 0;
    let last = Date.now();
    const iv = window.setInterval(() => {
      const now = Date.now();
      if (!holdRef.current) elapsed += now - last;
      last = now;
      const left = Math.max(0, DISMISS_MS - elapsed);
      setRemaining(left);
      if (left === 0) {
        window.clearInterval(iv);
        close();
      }
    }, TICK_MS);
    return () => window.clearInterval(iv);
  }, []);

  const openFull = async () => {
    holdRef.current = true;
    try {
      await api.openEditor(id);
    } catch {
      /* editor failed to open; still dismiss the card */
    }
    close();
  };

  const doCopy = async () => {
    holdRef.current = true;
    try {
      const data = await api.loadCapture(id);
      await api.copyImage(data);
      setCopied(true);
      window.setTimeout(close, 700);
    } catch {
      holdRef.current = false;
    }
  };

  return (
    <div
      onMouseEnter={() => {
        holdRef.current = true;
      }}
      onMouseLeave={() => {
        if (!copied) holdRef.current = false;
      }}
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl backdrop-blur transition-all duration-150 ${
        leaving ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Screenshot saved
        </span>
        <div className="flex-1" />
        <button
          title="Dismiss"
          onClick={close}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={13} />
        </button>
      </div>

      <button
        onClick={openFull}
        title="Click to open and edit"
        className="mx-3 mt-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-zinc-950 ring-1 ring-zinc-700/70 hover:ring-cyan-500"
      >
        {src && (
          <img
            src={src}
            draggable={false}
            alt="Screenshot preview"
            className="max-h-full max-w-full object-contain"
          />
        )}
      </button>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={openFull}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
        >
          <Maximize2 size={13} />
          Full screen
        </button>
        <button
          onClick={doCopy}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
            copied
              ? "bg-emerald-600 text-white"
              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          }`}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="h-0.5 w-full bg-zinc-800">
        <div
          className="h-full bg-cyan-500/70 transition-[width] duration-100 ease-linear"
          style={{ width: `${(remaining / DISMISS_MS) * 100}%` }}
        />
      </div>
    </div>
  );
}
