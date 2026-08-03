import { useCallback, useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Pen,
  Highlighter,
  Minus,
  MoveUpRight,
  Square,
  Circle,
  Type,
  Grid3x3,
  Hash,
  Crop,
  Undo2,
  Redo2,
  Pin,
  Copy,
  Save,
  Download,
  Sparkles,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { api } from "../lib/api";

type Tool =
  | "select"
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "pixelate"
  | "counter"
  | "crop";

interface Obj {
  id: number;
  type: Tool;
  color: string;
  size: number;
  points?: { x: number; y: number }[];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  n?: number;
  fs?: number;
}

type HandleKey = "nw" | "ne" | "se" | "sw";

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snapshot {
  objects: Obj[];
  base: HTMLCanvasElement;
}

interface TextEdit {
  x: number;
  y: number;
  left: number;
  top: number;
  scale: number;
  value: string;
  openedAt: number;
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111111",
  "#ffffff",
];

const BACKGROUNDS = [
  ["#0ea5e9", "#6366f1"],
  ["#f97316", "#ef4444"],
  ["#22c55e", "#0d9488"],
  ["#a855f7", "#ec4899"],
  ["#0f172a", "#334155"],
  ["#fbbf24", "#f97316"],
  ["#e2e8f0", "#94a3b8"],
  ["#18181b", "#18181b"],
];

let objId = 1;

const measureCtx = document.createElement("canvas").getContext("2d")!;

function textFont(o: Obj) {
  return Math.max(6, o.fs ?? 14 + o.size * 5);
}

function textSize(o: Obj) {
  const fs = textFont(o);
  const lines = (o.text ?? "").split("\n");
  measureCtx.font = `bold ${fs}px "Segoe UI", sans-serif`;
  const w = Math.max(
    fs * 0.6,
    ...lines.map((l) => measureCtx.measureText(l).width)
  );
  return { fs, lines, w, h: lines.length * fs * 1.25 };
}

function normRect(o: Obj) {
  const x = Math.min(o.x1!, o.x2!);
  const y = Math.min(o.y1!, o.y2!);
  const w = Math.abs(o.x2! - o.x1!);
  const h = Math.abs(o.y2! - o.y1!);
  return { x, y, w, h };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawObj(
  ctx: CanvasRenderingContext2D,
  o: Obj,
  base: HTMLCanvasElement
) {
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (o.type === "pen" || o.type === "highlighter") {
    if (!o.points || o.points.length < 2) {
      ctx.restore();
      return;
    }
    if (o.type === "highlighter") {
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = o.size * 4;
    }
    ctx.beginPath();
    ctx.moveTo(o.points[0].x, o.points[0].y);
    for (const p of o.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else if (o.type === "line") {
    ctx.beginPath();
    ctx.moveTo(o.x1!, o.y1!);
    ctx.lineTo(o.x2!, o.y2!);
    ctx.stroke();
  } else if (o.type === "arrow") {
    const dx = o.x2! - o.x1!;
    const dy = o.y2! - o.y1!;
    const len = Math.hypot(dx, dy);
    if (len < 2) {
      ctx.restore();
      return;
    }
    const head = Math.max(12, o.size * 3.5);
    const ang = Math.atan2(dy, dx);
    const ex = o.x2! - Math.cos(ang) * head * 0.6;
    const ey = o.y2! - Math.sin(ang) * head * 0.6;
    ctx.beginPath();
    ctx.moveTo(o.x1!, o.y1!);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.x2!, o.y2!);
    ctx.lineTo(
      o.x2! - head * Math.cos(ang - Math.PI / 7),
      o.y2! - head * Math.sin(ang - Math.PI / 7)
    );
    ctx.lineTo(
      o.x2! - head * Math.cos(ang + Math.PI / 7),
      o.y2! - head * Math.sin(ang + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fill();
  } else if (o.type === "rect") {
    const r = normRect(o);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (o.type === "ellipse") {
    const r = normRect(o);
    ctx.beginPath();
    ctx.ellipse(
      r.x + r.w / 2,
      r.y + r.h / 2,
      r.w / 2,
      r.h / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else if (o.type === "pixelate") {
    const r = normRect(o);
    if (r.w >= 2 && r.h >= 2) {
      const px = Math.max(8, o.size * 3);
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.ceil(r.w / px));
      off.height = Math.max(1, Math.ceil(r.h / px));
      const octx = off.getContext("2d")!;
      octx.imageSmoothingEnabled = false;
      octx.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, off.width, off.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, off.width, off.height, r.x, r.y, r.w, r.h);
    }
  } else if (o.type === "counter") {
    const r = 14 + o.size * 2;
    ctx.beginPath();
    ctx.arc(o.x1!, o.y1!, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${r}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(o.n ?? 1), o.x1!, o.y1! + r * 0.06);
  } else if (o.type === "crop") {
    const r = normRect(o);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, base.width, base.height);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = Math.max(1.5, base.width / 700);
    ctx.setLineDash([9, 6]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (o.type === "text") {
    const { fs, lines } = textSize(o);
    ctx.font = `bold ${fs}px "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(2, fs * 0.09);
      ctx.strokeText(line, o.x1!, o.y1! + i * fs * 1.25);
      ctx.fillText(line, o.x1!, o.y1! + i * fs * 1.25);
    });
  }
  ctx.restore();
}

function objBounds(o: Obj): { x: number; y: number; w: number; h: number } {
  if (o.points && o.points.length) {
    const xs = o.points.map((p) => p.x);
    const ys = o.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (o.type === "counter") {
    const r = 14 + o.size * 2;
    return { x: o.x1! - r, y: o.y1! - r, w: r * 2, h: r * 2 };
  }
  if (o.type === "text") {
    const { w, h } = textSize(o);
    return { x: o.x1!, y: o.y1!, w, h };
  }
  return normRect(o);
}

function handleAnchors(b: Bounds, pad: number) {
  return [
    { key: "nw" as HandleKey, cx: b.x - pad, cy: b.y - pad },
    { key: "ne" as HandleKey, cx: b.x + b.w + pad, cy: b.y - pad },
    { key: "se" as HandleKey, cx: b.x + b.w + pad, cy: b.y + b.h + pad },
    { key: "sw" as HandleKey, cx: b.x - pad, cy: b.y + b.h + pad },
  ];
}

function oppositeCorner(b: Bounds, key: HandleKey) {
  const left = b.x;
  const right = b.x + b.w;
  const top = b.y;
  const bottom = b.y + b.h;
  if (key === "nw") return { x: right, y: bottom };
  if (key === "ne") return { x: left, y: bottom };
  if (key === "se") return { x: left, y: top };
  return { x: right, y: top };
}

function scaleObj(o: Obj, ax: number, ay: number, f: number): Obj {
  const mx = (x: number) => ax + (x - ax) * f;
  const my = (y: number) => ay + (y - ay) * f;
  const m: Obj = { ...o };
  if (o.points) m.points = o.points.map((p) => ({ x: mx(p.x), y: my(p.y) }));
  if (o.x1 != null) m.x1 = mx(o.x1);
  if (o.y1 != null) m.y1 = my(o.y1);
  if (o.x2 != null) m.x2 = mx(o.x2);
  if (o.y2 != null) m.y2 = my(o.y2);
  if (o.type === "text") {
    m.fs = Math.max(8, textFont(o) * f);
  } else if (o.type === "counter") {
    m.size = Math.max(0.5, ((14 + o.size * 2) * f - 14) / 2);
  } else if (o.type === "pen" || o.type === "highlighter") {
    m.size = Math.max(1, o.size * f);
  }
  return m;
}

export default function Editor({ id }: { id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [draft, setDraft] = useState<Obj | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [beautify, setBeautify] = useState(false);
  const [bg, setBg] = useState(0);
  const [pad, setPad] = useState(64);
  const [radius, setRadius] = useState(16);
  const [shadow, setShadow] = useState(true);
  const [toast, setToast] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [version, setVersion] = useState(0);
  const [hoverHandle, setHoverHandle] = useState<HandleKey | null>(null);
  const [counterNext, setCounterNext] = useState(1);
  const [sizeHint, setSizeHint] = useState<{
    left: number;
    top: number;
    label: string;
  } | null>(null);
  const resizeRef = useRef<{
    key: HandleKey;
    ax: number;
    ay: number;
    w: number;
    h: number;
    obj: Obj;
  } | null>(null);
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const wrapRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const textEditRef = useRef<TextEdit | null>(textEdit);
  textEditRef.current = textEdit;

  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  useEffect(() => {
    api
      .loadCapture(id)
      .then((dataUrl) => {
        const img = new Image();
        img.onload = () => {
          const base = document.createElement("canvas");
          base.width = img.naturalWidth;
          base.height = img.naturalHeight;
          base.getContext("2d")!.drawImage(img, 0, 0);
          baseRef.current = base;
          setReady(true);
        };
        img.onerror = () => showToast("Could not open this screenshot");
        img.src = dataUrl;
      })
      .catch((e) => showToast(String(e)));
  }, [id]);

  const viewScale = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return 1;
    const r = canvas.getBoundingClientRect();
    return r.width ? r.width / canvas.width : 1;
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    for (const o of objects) drawObj(ctx, o, base);
    if (draft) drawObj(ctx, draft, base);
    if (selected != null) {
      const o = objects.find((x) => x.id === selected);
      if (o) {
        const b = objBounds(o);
        const s = viewScale();
        const pad = 6 / s;
        const hs = 11 / s;
        ctx.save();
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        ctx.setLineDash([]);
        for (const h of handleAnchors(b, pad)) {
          ctx.beginPath();
          ctx.arc(h.cx, h.cy, hs / 2, 0, Math.PI * 2);
          ctx.fillStyle = "#22d3ee";
          ctx.fill();
          ctx.lineWidth = 1.5 / s;
          ctx.strokeStyle = "#0b1220";
          ctx.stroke();
          ctx.strokeStyle = "#0b1220";
          ctx.lineWidth = 1.6 / s;
          ctx.lineCap = "round";
          const d = hs * 0.22;
          const dx = h.key === "nw" || h.key === "sw" ? -1 : 1;
          const dy = h.key === "nw" || h.key === "ne" ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(h.cx - dx * d, h.cy - dy * d);
          ctx.lineTo(h.cx + dx * d, h.cy + dy * d);
          ctx.moveTo(h.cx + dx * d, h.cy + dy * d);
          ctx.lineTo(h.cx + dx * d * 0.1, h.cy + dy * d);
          ctx.moveTo(h.cx + dx * d, h.cy + dy * d);
          ctx.lineTo(h.cx + dx * d, h.cy + dy * d * 0.1);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [objects, draft, selected, ready, version]);

  useEffect(() => {
    const onResize = () => setVersion((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pushUndo = () => {
    const base = baseRef.current;
    if (!base) return;
    undoRef.current.push({ objects: objectsRef.current, base });
    if (undoRef.current.length > 40) undoRef.current.shift();
    redoRef.current = [];
  };

  const applySnapshot = (
    from: Snapshot[],
    to: Snapshot[]
  ) => {
    const snap = from.pop();
    const base = baseRef.current;
    if (!snap || !base) return;
    to.push({ objects: objectsRef.current, base });
    baseRef.current = snap.base;
    setObjects(snap.objects);
    setSelected(null);
    setDraft(null);
    setVersion((v) => v + 1);
  };

  const undo = () => applySnapshot(undoRef.current, redoRef.current);
  const redo = () => applySnapshot(redoRef.current, undoRef.current);

  const toCanvas = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const openTextAt = (p: { x: number; y: number }, e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current;
    const cr = canvas.getBoundingClientRect();
    const wr = wrap ? wrap.getBoundingClientRect() : cr;
    const rawLeft = e.clientX - wr.left - 8;
    const rawTop = e.clientY - wr.top - 6;
    setTextEdit({
      x: p.x,
      y: p.y,
      left: Math.max(0, Math.min(rawLeft, Math.max(0, wr.width - 190))),
      top: Math.max(0, Math.min(rawTop, Math.max(0, wr.height - 46))),
      scale: cr.width / canvas.width || 1,
      value: "",
      openedAt: Date.now(),
    });
  };

  const commitText = () => {
    const te = textEditRef.current;
    if (!te) return;
    textEditRef.current = null;
    if (te.value.trim()) {
      pushUndo();
      const id = objId++;
      setObjects((prev) => [
        ...prev,
        {
          id,
          type: "text",
          color,
          size,
          x1: te.x,
          y1: te.y,
          text: te.value,
        },
      ]);
      setSelected(id);
      setTool("select");
    }
    setTextEdit(null);
  };

  const focusTextInput = () => {
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const el = textInputRef.current;
      if (!el || !textEditRef.current) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      if (document.activeElement !== el && tries++ < 20) {
        raf = requestAnimationFrame(attempt);
      }
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  };

  const onTextBlur = () => {
    const te = textEditRef.current;
    if (te && !te.value && Date.now() - te.openedAt < 600) {
      focusTextInput();
      return;
    }
    commitText();
  };

  useEffect(() => {
    if (!textEdit) return;
    return focusTextInput();
  }, [textEdit?.openedAt]);

  const selectedObj = () =>
    selected == null
      ? undefined
      : objectsRef.current.find((o) => o.id === selected);

  const hitHandle = (p: { x: number; y: number }): HandleKey | null => {
    const o = selectedObj();
    if (!o) return null;
    const s = viewScale();
    const b = objBounds(o);
    const tol = 9 / s;
    for (const h of handleAnchors(b, 6 / s)) {
      if (Math.abs(p.x - h.cx) <= tol && Math.abs(p.y - h.cy) <= tol)
        return h.key;
    }
    return null;
  };

  const showSizeHint = (e: React.PointerEvent, label: string) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    setSizeHint({
      left: e.clientX - wr.left + 16,
      top: e.clientY - wr.top + 16,
      label,
    });
  };

  const hintFor = (o: Obj, f: number) =>
    o.type === "text"
      ? `${Math.round(textFont(o))} px`
      : `${Math.round(f * 100)}%`;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ready) return;
    const p = toCanvas(e);
    if (textEdit) {
      e.preventDefault();
      commitText();
      if (tool === "text") openTextAt(p, e);
      return;
    }
    if (tool !== "text") {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (tool === "select") {
      const key = hitHandle(p);
      const target = selectedObj();
      if (key && target) {
        pushUndo();
        const b = objBounds(target);
        const a = oppositeCorner(b, key);
        resizeRef.current = {
          key,
          ax: a.x,
          ay: a.y,
          w: Math.max(1, b.w),
          h: Math.max(1, b.h),
          obj: target,
        };
        showSizeHint(e, hintFor(target, 1));
        return;
      }
      const hit = [...objects].reverse().find((o) => {
        const b = objBounds(o);
        return (
          p.x >= b.x - 8 &&
          p.x <= b.x + b.w + 8 &&
          p.y >= b.y - 8 &&
          p.y <= b.y + b.h + 8
        );
      });
      setSelected(hit?.id ?? null);
      if (hit) {
        pushUndo();
        dragRef.current = { x: p.x, y: p.y, moved: false };
      }
      return;
    }
    if (tool === "text") {
      e.preventDefault();
      openTextAt(p, e);
      return;
    }
    if (tool === "counter") {
      pushUndo();
      const n = counterNext;
      setCounterNext(n + 1);
      setObjects((prev) => [
        ...prev,
        { id: objId++, type: "counter", color, size, x1: p.x, y1: p.y, n },
      ]);
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      setDraft({ id: objId++, type: tool, color, size, points: [p] });
    } else {
      setDraft({
        id: objId++,
        type: tool,
        color,
        size,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toCanvas(e);
    const rz = resizeRef.current;
    if (tool === "select" && rz) {
      const fx = Math.abs(p.x - rz.ax) / rz.w;
      const fy = Math.abs(p.y - rz.ay) / rz.h;
      const f = Math.max(0.08, Math.max(fx, fy));
      const next = scaleObj(rz.obj, rz.ax, rz.ay, f);
      setObjects((prev) => prev.map((o) => (o.id === rz.obj.id ? next : o)));
      showSizeHint(e, hintFor(next, f));
      return;
    }
    if (tool === "select" && !dragRef.current) {
      setHoverHandle(hitHandle(p));
    }
    if (tool === "select" && dragRef.current && selected != null) {
      const dx = p.x - dragRef.current.x;
      const dy = p.y - dragRef.current.y;
      dragRef.current = { x: p.x, y: p.y, moved: true };
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== selected) return o;
          const m = { ...o };
          if (m.points) m.points = m.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
          if (m.x1 != null) m.x1 += dx;
          if (m.y1 != null) m.y1 += dy;
          if (m.x2 != null) m.x2 += dx;
          if (m.y2 != null) m.y2 += dy;
          return m;
        })
      );
      return;
    }
    if (!draft) return;
    if (draft.points) {
      setDraft({ ...draft, points: [...draft.points, p] });
    } else {
      setDraft({ ...draft, x2: p.x, y2: p.y });
    }
  };

  const onPointerUp = () => {
    if (tool === "select") {
      if (resizeRef.current) {
        resizeRef.current = null;
        setSizeHint(null);
        return;
      }
      if (dragRef.current && !dragRef.current.moved) undoRef.current.pop();
      dragRef.current = null;
      return;
    }
    if (!draft) return;
    if (draft.type === "crop") {
      const r = normRect(draft);
      setDraft(null);
      if (r.w > 10 && r.h > 10) {
        pushUndo();
        const base = baseRef.current!;
        const full = document.createElement("canvas");
        full.width = base.width;
        full.height = base.height;
        const fctx = full.getContext("2d")!;
        fctx.drawImage(base, 0, 0);
        for (const o of objectsRef.current) drawObj(fctx, o, base);
        const cropped = document.createElement("canvas");
        cropped.width = Math.round(r.w);
        cropped.height = Math.round(r.h);
        cropped
          .getContext("2d")!
          .drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        baseRef.current = cropped;
        setObjects([]);
        setSelected(null);
        setVersion((v) => v + 1);
      }
      return;
    }
    const isEmptyShape = draft.points
      ? draft.points.length < 2
      : Math.abs((draft.x2 ?? 0) - (draft.x1 ?? 0)) < 3 &&
        Math.abs((draft.y2 ?? 0) - (draft.y1 ?? 0)) < 3;
    if (!isEmptyShape) {
      pushUndo();
      setObjects((prev) => [...prev, draft]);
    }
    setDraft(null);
  };

  const renderFull = (): HTMLCanvasElement => {
    const base = baseRef.current!;
    const flat = document.createElement("canvas");
    flat.width = base.width;
    flat.height = base.height;
    const fctx = flat.getContext("2d")!;
    fctx.drawImage(base, 0, 0);
    for (const o of objectsRef.current) drawObj(fctx, o, base);
    if (!beautify) return flat;
    const p = pad;
    const out = document.createElement("canvas");
    out.width = flat.width + p * 2;
    out.height = flat.height + p * 2;
    const ctx = out.getContext("2d")!;
    const [c1, c2] = BACKGROUNDS[bg];
    const grad = ctx.createLinearGradient(0, 0, out.width, out.height);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.save();
    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = p * 0.6;
      ctx.shadowOffsetY = p * 0.2;
    }
    roundRectPath(ctx, p, p, flat.width, flat.height, radius);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, p, p, flat.width, flat.height, radius);
    ctx.clip();
    ctx.drawImage(flat, p, p);
    ctx.restore();
    return out;
  };

  const exportData = () => renderFull().toDataURL("image/png");

  const doCopy = async () => {
    if (!ready) return;
    try {
      await api.copyImage(exportData());
      showToast("Copied to clipboard");
    } catch (e) {
      showToast(`Copy failed: ${e}`);
    }
  };

  const doQuickSave = async () => {
    if (!ready) return;
    try {
      const data = exportData();
      const path = await api.quickSave(data, `ColdShot_${id}.png`);
      await api.updateCapture(id, data).catch(() => {});
      setSavedPath(path);
      showToast(`Saved to ${path}`);
    } catch (e) {
      showToast(`Save failed: ${e}`);
    }
  };

  const doSaveAs = async () => {
    if (!ready) return;
    try {
      const data = exportData();
      const path = await api.saveImageAs(data, `ColdShot_${id}.png`);
      if (path) {
        await api.updateCapture(id, data).catch(() => {});
        setSavedPath(path);
        showToast(`Saved to ${path}`);
      }
    } catch (e) {
      showToast(`Save failed: ${e}`);
    }
  };

  const doPin = async () => {
    if (!ready) return;
    try {
      await api.pinImage(exportData());
    } catch (e) {
      showToast(`Pin failed: ${e}`);
    }
  };

  const deleteSelected = () => {
    if (selected == null) return;
    pushUndo();
    setObjects((prev) => prev.filter((o) => o.id !== selected));
    setSelected(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textEditRef.current) {
        if (document.activeElement !== textInputRef.current) focusTextInput();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && !e.ctrlKey) return;
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        doCopy();
      } else if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doQuickSave();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tools: { t: Tool; icon: React.ReactNode; label: string }[] = [
    { t: "select", icon: <MousePointer2 size={17} />, label: "Select" },
    { t: "pen", icon: <Pen size={17} />, label: "Pen" },
    { t: "highlighter", icon: <Highlighter size={17} />, label: "Highlighter" },
    { t: "line", icon: <Minus size={17} />, label: "Line" },
    { t: "arrow", icon: <MoveUpRight size={17} />, label: "Arrow" },
    { t: "rect", icon: <Square size={17} />, label: "Rectangle" },
    { t: "ellipse", icon: <Circle size={17} />, label: "Ellipse" },
    { t: "text", icon: <Type size={17} />, label: "Text" },
    { t: "pixelate", icon: <Grid3x3 size={17} />, label: "Pixelate" },
    { t: "counter", icon: <Hash size={17} />, label: "Counter" },
    { t: "crop", icon: <Crop size={17} />, label: "Crop" },
  ];

  const canvasStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="flex shrink-0 items-center gap-1">
          {tools.map(({ t, icon, label }) => (
            <button
              key={t}
              title={label}
              onClick={() => {
                setTool(t);
                setSelected(null);
              }}
              className={`shrink-0 rounded-md p-2 transition-colors ${
                tool === t
                  ? "bg-cyan-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {icon}
            </button>
          ))}
        </div>

        {tool === "counter" && (
          <div className="ml-1 flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 py-1 pl-2 pr-1 text-xs text-zinc-300">
            <span>
              Next{" "}
              <span className="font-semibold tabular-nums text-cyan-300">
                {counterNext}
              </span>
            </span>
            <button
              title="Reset counter to 1"
              onClick={() => {
                setCounterNext(1);
                showToast("Counter reset to 1");
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        )}

        <div className="mx-1.5 h-6 w-px shrink-0 bg-zinc-700" />

        <div className="flex shrink-0 items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                color === c ? "border-cyan-400 scale-110" : "border-zinc-600"
              }`}
              style={{ background: c }}
            />
          ))}
          <input
            type="range"
            min={1}
            max={12}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="ml-2 w-20 shrink-0 accent-cyan-500"
            title="Size"
          />
          <span className="w-4 shrink-0 text-center text-xs tabular-nums text-zinc-400">
            {size}
          </span>
        </div>

        <div className="mx-1.5 h-6 w-px shrink-0 bg-zinc-700" />

        <div className="flex shrink-0 items-center gap-1">
          <button
            title="Undo"
            onClick={undo}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Undo2 size={17} />
          </button>
          <button
            title="Redo"
            onClick={redo}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Redo2 size={17} />
          </button>
          <button
            title="Delete selected"
            onClick={deleteSelected}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Trash2 size={17} />
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            title="Beautify"
            onClick={() => setBeautify(!beautify)}
            className={`rounded-md p-2 ${
              beautify
                ? "bg-fuchsia-600 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
          >
            <Sparkles size={17} />
          </button>
          <div className="mx-1 h-6 w-px shrink-0 bg-zinc-700" />
          <button
            title="Pin to screen"
            onClick={doPin}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Pin size={17} />
          </button>
          <button
            title="Copy (Ctrl+C)"
            onClick={doCopy}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Copy size={17} />
          </button>
          <button
            title="Quick save (Ctrl+S)"
            onClick={doQuickSave}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Save size={17} />
          </button>
          <button
            onClick={doSaveAs}
            className="ml-1 flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
          >
            <Download size={15} />
            Save As
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-2 sm:p-4">
          <div
            ref={wrapRef}
            className="relative flex max-h-full max-w-full items-center justify-center"
            style={
              beautify
                ? {
                    background: `linear-gradient(135deg, ${BACKGROUNDS[bg][0]}, ${BACKGROUNDS[bg][1]})`,
                    padding: Math.max(8, pad / 4),
                    borderRadius: 12,
                  }
                : undefined
            }
          >
            <canvas
              ref={canvasRef}
              style={{
                ...canvasStyle,
                borderRadius: beautify ? radius / 4 : 0,
                cursor: hoverHandle
                  ? hoverHandle === "nw" || hoverHandle === "se"
                    ? "nwse-resize"
                    : "nesw-resize"
                  : undefined,
              }}
              className={
                tool === "select"
                  ? "cursor-default"
                  : tool === "text"
                  ? "cursor-text"
                  : "cursor-crosshair"
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            {textEdit && (
              <textarea
                ref={textInputRef}
                rows={1}
                spellCheck={false}
                value={textEdit.value}
                onChange={(e) => {
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                  setTextEdit({ ...textEdit, value: el.value });
                }}
                onBlur={onTextBlur}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commitText();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    textEditRef.current = null;
                    setTextEdit(null);
                  }
                }}
                placeholder="Type text, Enter to place"
                className="absolute z-10 resize-none overflow-hidden rounded border-2 border-cyan-500 bg-zinc-900/95 px-1.5 py-1 leading-tight shadow-lg outline-none placeholder:text-zinc-500"
                style={{
                  left: textEdit.left,
                  top: textEdit.top,
                  color,
                  fontFamily: '"Segoe UI", sans-serif',
                  fontWeight: 700,
                  fontSize: Math.max(
                    13,
                    Math.round((14 + size * 5) * textEdit.scale)
                  ),
                  minWidth: 170,
                  maxWidth: 380,
                }}
              />
            )}
            {sizeHint && (
              <div
                className="pointer-events-none absolute z-20 rounded bg-zinc-900/95 px-2 py-1 text-xs font-semibold tabular-nums text-cyan-300 shadow-lg ring-1 ring-cyan-500/40"
                style={{ left: sizeHint.left, top: sizeHint.top }}
              >
                {sizeHint.label}
              </div>
            )}
          </div>
          {toast && (
            <div className="absolute bottom-5 left-1/2 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-100 shadow-xl">
              <span className="truncate">{toast}</span>
              {savedPath && toast.startsWith("Saved to") && (
                <button
                  onClick={() => api.revealPath(savedPath).catch(() => {})}
                  className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-xs text-cyan-300 hover:bg-zinc-600"
                >
                  Show
                </button>
              )}
            </div>
          )}
        </div>
        {beautify && (
          <div className="w-44 shrink-0 space-y-4 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-3 sm:w-56 sm:p-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Background
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BACKGROUNDS.map(([c1, c2], i) => (
                  <button
                    key={i}
                    onClick={() => setBg(i)}
                    className={`h-9 rounded-lg border-2 ${
                      bg === i ? "border-cyan-400" : "border-zinc-700"
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${c1}, ${c2})`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Padding: {pad}px
              </div>
              <input
                type="range"
                min={16}
                max={240}
                value={pad}
                onChange={(e) => setPad(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Corner radius: {radius}px
              </div>
              <input
                type="range"
                min={0}
                max={48}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={shadow}
                onChange={(e) => setShadow(e.target.checked)}
                className="accent-cyan-500"
              />
              Drop shadow
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
