import { useEffect, useRef, useState } from "react";
import { api, OverlayData, WinRect } from "../lib/api";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function Overlay() {
  const [data, setData] = useState<OverlayData | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const [hoverWin, setHoverWin] = useState<WinRect | null>(null);
  const [mouse, setMouse] = useState({ x: -100, y: -100 });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    api.getOverlayData().then(setData).catch(() => api.cancelCapture());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (doneRef.current) return;
        doneRef.current = true;
        api.cancelCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const findWindow = (x: number, y: number, wins: WinRect[]) =>
    wins.find((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) ??
    null;

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    setMouse({ x: e.clientX, y: e.clientY });
    if (!data) return;
    if (startRef.current) {
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggingRef.current = true;
      if (draggingRef.current) {
        setSel({
          x: Math.min(startRef.current.x, e.clientX),
          y: Math.min(startRef.current.y, e.clientY),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
        setHoverWin(null);
        return;
      }
    }
    setHoverWin(findWindow(e.clientX, e.clientY, data.windows));
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0 || doneRef.current) return;
    const pressed = startRef.current !== null;
    const dragged = draggingRef.current;
    startRef.current = null;
    draggingRef.current = false;
    if (!pressed) return;
    if (dragged && sel && sel.w > 4 && sel.h > 4) {
      doneRef.current = true;
      api.finishCapture(sel.x, sel.y, sel.w, sel.h);
      return;
    }
    const win = data ? findWindow(e.clientX, e.clientY, data.windows) : null;
    if (win) {
      doneRef.current = true;
      api.finishCapture(win.x, win.y, win.w, win.h);
    } else {
      setSel(null);
    }
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    api.cancelCapture();
  };

  const active = sel ?? hoverWin;

  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden bg-black"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      {data && (
        <img
          src={data.image}
          className="absolute inset-0 h-full w-full"
          draggable={false}
          alt=""
        />
      )}
      {active ? (
        <div
          className="absolute border border-cyan-400"
          style={{
            left: active.x,
            top: active.y,
            width: active.w,
            height: active.h,
            boxShadow: "0 0 0 100000px rgba(0,0,0,0.45)",
          }}
        >
          <div className="absolute -top-7 left-0 rounded bg-zinc-900/90 px-2 py-0.5 font-mono text-xs text-cyan-300">
            {Math.round(active.w)} x {Math.round(active.h)}
          </div>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 bg-black/35" />
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-cyan-400/60"
            style={{ left: mouse.x }}
          />
          <div
            className="pointer-events-none absolute left-0 right-0 h-px bg-cyan-400/60"
            style={{ top: mouse.y }}
          />
        </>
      )}
      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-zinc-200 shadow-lg">
        Drag to select an area. Click a window to capture it. Right click or Esc
        to cancel.
      </div>
    </div>
  );
}
