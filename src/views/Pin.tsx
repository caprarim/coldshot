import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";

export default function Pin({ pid }: { pid: string }) {
  const [src, setSrc] = useState("");
  const aspectRef = useRef(0);
  const sizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    api.getPinImage(pid).then(setSrc).catch(() => setSrc(""));
  }, [pid]);

  const label = getCurrentWindow().label;

  const onWheel = (e: React.WheelEvent) => {
    if (!aspectRef.current) return;
    const base = sizeRef.current ?? {
      w: window.innerWidth,
      h: window.innerHeight,
    };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const maxW = window.screen.availWidth || 3840;
    const w = Math.round(Math.min(maxW, Math.max(120, base.w * factor)));
    const h = Math.round(Math.max(68, w * aspectRef.current));
    sizeRef.current = { w, h };
    api.resizeWindow(label, w, h).catch(() => {});
  };

  return (
    <div
      data-tauri-drag-region
      className="h-full w-full cursor-move overflow-hidden rounded-lg ring-1 ring-cyan-500/60"
      onDoubleClick={() => api.closeWindow(label)}
      onWheel={onWheel}
      title="Drag to move. Scroll to resize. Double click to close."
    >
      {src && (
        <img
          src={src}
          data-tauri-drag-region
          draggable={false}
          className="pointer-events-none h-full w-full object-fill"
          onLoad={(e) => {
            const img = e.currentTarget;
            aspectRef.current = img.naturalWidth
              ? img.naturalHeight / img.naturalWidth
              : 0;
            sizeRef.current = {
              w: window.innerWidth,
              h: window.innerHeight,
            };
          }}
          alt=""
        />
      )}
    </div>
  );
}
