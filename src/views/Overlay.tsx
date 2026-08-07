import { useEffect, useRef } from "react";
import { api, WinRect } from "../lib/api";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function Overlay() {
  const imgRef = useRef<HTMLImageElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const hLineRef = useRef<HTMLDivElement>(null);

  const winsRef = useRef<WinRect[]>([]);
  const selRef = useRef<Rect | null>(null);
  const hoverRef = useRef<WinRect | null>(null);
  const mouseRef = useRef({ x: -100, y: -100 });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const doneRef = useRef(false);
  const frameRef = useRef(0);

  useEffect(() => {
    const paint = () => {
      const top = topRef.current;
      const bottom = bottomRef.current;
      const left = leftRef.current;
      const right = rightRef.current;
      const box = boxRef.current;
      const label = labelRef.current;
      const vLine = vLineRef.current;
      const hLine = hLineRef.current;
      if (!top || !bottom || !left || !right || !box || !label) return;
      if (!vLine || !hLine) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const active = selRef.current ?? hoverRef.current;

      if (active) {
        const x = Math.max(0, Math.min(active.x, vw));
        const y = Math.max(0, Math.min(active.y, vh));
        const w = Math.max(0, Math.min(active.w, vw - x));
        const h = Math.max(0, Math.min(active.h, vh - y));
        top.style.height = `${y}px`;
        bottom.style.top = `${y + h}px`;
        bottom.style.height = `${Math.max(0, vh - y - h)}px`;
        left.style.top = `${y}px`;
        left.style.height = `${h}px`;
        left.style.width = `${x}px`;
        right.style.top = `${y}px`;
        right.style.height = `${h}px`;
        right.style.left = `${x + w}px`;
        right.style.width = `${Math.max(0, vw - x - w)}px`;
        box.style.display = "block";
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        label.textContent = `${Math.round(w)} x ${Math.round(h)}`;
        vLine.style.display = "none";
        hLine.style.display = "none";
        return;
      }

      top.style.height = `${vh}px`;
      bottom.style.height = "0px";
      left.style.width = "0px";
      right.style.width = "0px";
      box.style.display = "none";
      vLine.style.display = "block";
      vLine.style.transform = `translate3d(${mouseRef.current.x}px, 0, 0)`;
      hLine.style.display = "block";
      hLine.style.transform = `translate3d(0, ${mouseRef.current.y}px, 0)`;
    };

    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        paint();
      });
    };

    paint();

    let url = "";
    let cancelled = false;

    const load = async () => {
      try {
        const meta = await api.getOverlayData();
        if (cancelled) return;
        winsRef.current = meta.windows;
        const bytes = await api.getOverlayImage();
        if (cancelled) return;
        const buf =
          bytes instanceof ArrayBuffer
            ? bytes
            : new Uint8Array(bytes as unknown as number[]);
        url = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        const img = imgRef.current;
        if (!img) return;
        img.src = url;
        await Promise.race([
          img.decode().catch(() => {}),
          new Promise((r) => setTimeout(r, 1200)),
        ]);
        if (cancelled) return;
        paint();
        api.overlayReady(meta.seq).catch(() => {});
      } catch {
        if (cancelled || doneRef.current) return;
        doneRef.current = true;
        api.cancelCapture().catch(() => {});
      }
    };
    load();

    const findWindow = (x: number, y: number) =>
      winsRef.current.find(
        (w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h
      ) ?? null;

    const cancel = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      api.cancelCapture();
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      draggingRef.current = false;
    };

    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      const start = startRef.current;
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggingRef.current = true;
        if (draggingRef.current) {
          selRef.current = {
            x: Math.min(start.x, e.clientX),
            y: Math.min(start.y, e.clientY),
            w: Math.abs(dx),
            h: Math.abs(dy),
          };
          hoverRef.current = null;
          schedule();
          return;
        }
      }
      hoverRef.current = findWindow(e.clientX, e.clientY);
      schedule();
    };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || doneRef.current) return;
      const pressed = startRef.current !== null;
      const dragged = draggingRef.current;
      startRef.current = null;
      draggingRef.current = false;
      if (!pressed) return;
      const sel = selRef.current;
      if (dragged && sel && sel.w > 4 && sel.h > 4) {
        doneRef.current = true;
        api.finishCapture(sel.x, sel.y, sel.w, sel.h);
        return;
      }
      const win = findWindow(e.clientX, e.clientY);
      if (win) {
        doneRef.current = true;
        api.finishCapture(win.x, win.y, win.w, win.h);
        return;
      }
      selRef.current = null;
      schedule();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      cancel();
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", schedule);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  return (
    <div className="fixed inset-0 cursor-crosshair select-none overflow-hidden bg-black">
      <img
        ref={imgRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        draggable={false}
        alt=""
      />
      <div
        ref={topRef}
        className="pointer-events-none absolute left-0 right-0 top-0 bg-black/45"
      />
      <div
        ref={bottomRef}
        className="pointer-events-none absolute left-0 right-0 bg-black/45"
      />
      <div
        ref={leftRef}
        className="pointer-events-none absolute left-0 bg-black/45"
      />
      <div ref={rightRef} className="pointer-events-none absolute bg-black/45" />
      <div
        ref={boxRef}
        className="pointer-events-none absolute border border-cyan-400"
        style={{ display: "none" }}
      >
        <div
          ref={labelRef}
          className="absolute -top-7 left-0 rounded bg-zinc-900/90 px-2 py-0.5 font-mono text-xs text-cyan-300"
        />
      </div>
      <div
        ref={vLineRef}
        className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-cyan-400/60"
        style={{ willChange: "transform" }}
      />
      <div
        ref={hLineRef}
        className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-cyan-400/60"
        style={{ willChange: "transform" }}
      />
      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-zinc-200 shadow-lg">
        Drag to select an area. Click a window to capture it. Right click or Esc
        to cancel.
      </div>
    </div>
  );
}
