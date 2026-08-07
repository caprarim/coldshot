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
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef(0);
  const dataRef = useRef<OverlayData | null>(null);

  useEffect(() => {
    api
      .getOverlayData()
      .then((d) => {
        dataRef.current = d;
        setData(d);
      })
      .catch(() => api.cancelCapture());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (doneRef.current) return;
        doneRef.current = true;
        api.cancelCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const findWindow = (x: number, y: number, wins: WinRect[]) =>
    wins.find((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) ??
    null;

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
  };

  const flush = () => {
    frameRef.current = 0;
    const p = pendingRef.current;
    if (!p) return;
    const start = startRef.current;
    if (start) {
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggingRef.current = true;
      if (draggingRef.current) {
        setSel({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
        setHoverWin(null);
        return;
      }
    }
    setMouse(p);
    const d = dataRef.current;
    if (d) setHoverWin(findWindow(p.x, p.y, d.windows));
  };

  const onMouseMove = (e: React.MouseEvent) => {
    pendingRef.current = { x: e.clientX, y: e.clientY };
    if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0 || doneRef.current) return;
    const start = startRef.current;
    const dragged = draggingRef.current;
    startRef.current = null;
    draggingRef.current = false;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (!start) return;
    if (dragged) {
      const rect = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        w: Math.abs(e.clientX - start.x),
        h: Math.abs(e.clientY - start.y),
      };
      if (rect.w > 4 && rect.h > 4) {
        doneRef.current = true;
        api.finishCapture(rect.x, rect.y, rect.w, rect.h);
        return;
      }
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
          className="absolute inset-0 h-full w-full transform-gpu"
          draggable={false}
          alt=""
        />
      )}
      {active ? (
        <>
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 bg-black/45"
            style={{ height: Math.max(0, active.y) }}
          />
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 bg-black/45"
            style={{ top: active.y + active.h }}
          />
          <div
            className="pointer-events-none absolute left-0 bg-black/45"
            style={{ top: active.y, height: active.h, width: Math.max(0, active.x) }}
          />
          <div
            className="pointer-events-none absolute right-0 bg-black/45"
            style={{ top: active.y, height: active.h, left: active.x + active.w }}
          />
          <div
            className="pointer-events-none absolute border border-cyan-400"
            style={{
              left: active.x,
              top: active.y,
              width: active.w,
              height: active.h,
            }}
          >
            <div className="absolute -top-7 left-0 rounded bg-zinc-900/90 px-2 py-0.5 font-mono text-xs text-cyan-300">
              {Math.round(active.w)} x {Math.round(active.h)}
            </div>
          </div>
        </>
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
