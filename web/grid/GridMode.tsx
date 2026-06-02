import { useCallback, useEffect, useRef, useState } from "react";
import { sceneToAscii } from "../../src/ascii";
import { shapeAabb } from "../../src/spec";
import type { DrawColor, Shape, Tool } from "../tools/types";
import type { GridStyle } from "./AppearancePanel";

// Logical ASCII cell (matches sceneToAscii defaults): 1 char = 8x16 scene px.
const ASCII_W = 8;
const ASCII_H = 16;
// On-screen size of one grid cell at zoom 1.
const CELL_W = 12;
const CELL_H = 22;
const RULER = 20;
// Font advance ~0.6*size, so size to the cell width (12/0.6 = 20) at zoom 1.
const BASE_FONT = 20;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

type GridModeProps = {
  canvasSize: { width: number; height: number };
  shapes: Shape[];
  tool: Tool;
  color: DrawColor;
  strokeWidth: number;
  style: GridStyle;
  selectedIds: string[];
  onAddShape: (shape: Shape) => void;
  onSelect: (ids: string[]) => void;
  onMove: (ids: string[], dx: number, dy: number) => void;
};

type Cell = { col: number; row: number };
type Delta = { dCol: number; dRow: number };
type TextDraft = { col: number; row: number; value: string };
type View = { panX: number; panY: number; zoom: number };

function shapeId() {
  return crypto.randomUUID();
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function translateShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.type === "pen" || shape.type === "arrow") {
    return { ...shape, points: shape.points.map((value, index) => value + (index % 2 === 0 ? dx : dy)) };
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

function cellBounds(shape: Shape) {
  const box = shapeAabb(shape);
  return {
    c0: Math.round(box.x / ASCII_W),
    r0: Math.round(box.y / ASCII_H),
    c1: Math.round((box.x + box.width) / ASCII_W),
    r1: Math.round((box.y + box.height) / ASCII_H)
  };
}

function rulerStep(zoom: number): number {
  for (const step of [5, 10, 20, 50, 100, 200]) {
    if (step * CELL_W * zoom >= 52) return step;
  }
  return 500;
}

export function GridMode(props: GridModeProps) {
  const { canvasSize, shapes, tool, color, strokeWidth, style, selectedIds, onAddShape, onSelect, onMove } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const textIntentRef = useRef<"commit" | "cancel" | null>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ panX: 24, panY: 24, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [draft, setDraft] = useState<Shape | null>(null);
  const [moveDelta, setMoveDelta] = useState<Delta | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const startRef = useRef<Cell | null>(null);
  const moveStartRef = useRef<Cell | null>(null);
  const moveIdsRef = useRef<string[]>([]);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceRef = useRef(false);
  const draftRef = useRef<Shape | null>(null);
  const moveDeltaRef = useRef<Delta | null>(null);
  const rafRef = useRef<number | null>(null);

  // World cell under a client point, using the current view. Clamped to the positive quadrant.
  const cellAt = useCallback((clientX: number, clientY: number): Cell => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { col: 0, row: 0 };
    const col = Math.round((clientX - rect.left - v.panX) / (CELL_W * v.zoom));
    const row = Math.round((clientY - rect.top - RULER - v.panY) / (CELL_H * v.zoom));
    return { col: Math.max(0, col), row: Math.max(0, row) };
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setDraft(draftRef.current);
      setMoveDelta(moveDeltaRef.current);
    });
  }, []);

  const hitTest = useCallback((cell: Cell): Shape | undefined => {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const bounds = cellBounds(shapes[index]);
      if (cell.col >= bounds.c0 && cell.col <= bounds.c1 && cell.row >= bounds.r0 && cell.row <= bounds.r1) return shapes[index];
    }
    return undefined;
  }, [shapes]);

  const draftFor = useCallback((start: Cell, end: Cell): Shape | null => {
    if (tool === "rect" || tool === "redact") {
      const x = Math.min(start.col, end.col) * ASCII_W;
      const y = Math.min(start.row, end.row) * ASCII_H;
      const w = Math.abs(end.col - start.col) * ASCII_W;
      const h = Math.abs(end.row - start.row) * ASCII_H;
      if (w === 0 || h === 0) return null;
      if (tool === "redact") return { id: shapeId(), type: "rect", x, y, width: w, height: h, color: "#111827", strokeWidth, fill: "#111827" };
      return {
        id: shapeId(), type: "rect", x, y, width: w, height: h, color, strokeWidth,
        ...(style.border !== "single" ? { strokeStyle: style.border } : {}),
        ...(style.fill !== "none" ? { fillStyle: style.fill } : {}),
        ...(style.rounded ? { rounded: true } : {}),
        ...(style.dashed ? { dashed: true } : {})
      };
    }
    if (tool === "arrow") {
      if (start.col === end.col && start.row === end.row) return null;
      return {
        id: shapeId(), type: "arrow", points: [start.col * ASCII_W, start.row * ASCII_H, end.col * ASCII_W, end.row * ASCII_H], color, strokeWidth,
        ...(style.border === "bold" || style.border === "double" ? { strokeStyle: style.border } : {}),
        ...(style.dashed ? { dashed: true } : {})
      };
    }
    return null;
  }, [color, strokeWidth, style, tool]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    // Space-drag or middle-button pans the infinite canvas.
    if (spaceRef.current || event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const v = viewRef.current;
      panRef.current = { x: event.clientX, y: event.clientY, panX: v.panX, panY: v.panY };
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (tool === "select") {
      const hit = hitTest(cell);
      onSelect(hit ? [hit.id] : []);
      moveStartRef.current = hit ? cell : null;
      moveIdsRef.current = hit ? [hit.id] : [];
      if (hit) event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool !== "rect" && tool !== "redact" && tool !== "arrow") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = cell;
  }, [cellAt, hitTest, onSelect, tool]);

  const onClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text" || spaceRef.current) return;
    const cell = cellAt(event.clientX, event.clientY);
    setTextDraft({ col: cell.col, row: cell.row, value: "" });
  }, [cellAt, tool]);

  const onTextBlur = useCallback(() => {
    const intent = textIntentRef.current;
    textIntentRef.current = null;
    if (intent !== "cancel" && textDraft && textDraft.value.trim()) {
      onAddShape({ id: shapeId(), type: "text", x: textDraft.col * ASCII_W, y: textDraft.row * ASCII_H, text: textDraft.value, color, strokeWidth });
    }
    setTextDraft(null);
  }, [color, onAddShape, strokeWidth, textDraft]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      const start = panRef.current;
      setView((v) => ({ ...v, panX: start.panX + (event.clientX - start.x), panY: start.panY + (event.clientY - start.y) }));
      return;
    }
    if (moveStartRef.current) {
      const cell = cellAt(event.clientX, event.clientY);
      moveDeltaRef.current = { dCol: cell.col - moveStartRef.current.col, dRow: cell.row - moveStartRef.current.row };
      scheduleRender();
      return;
    }
    if (!startRef.current) return;
    draftRef.current = draftFor(startRef.current, cellAt(event.clientX, event.clientY));
    scheduleRender();
  }, [cellAt, draftFor, scheduleRender]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) { panRef.current = null; return; }
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (moveStartRef.current) {
      const cell = cellAt(event.clientX, event.clientY);
      const dCol = cell.col - moveStartRef.current.col;
      const dRow = cell.row - moveStartRef.current.row;
      const ids = moveIdsRef.current;
      moveStartRef.current = null;
      moveIdsRef.current = [];
      moveDeltaRef.current = null;
      setMoveDelta(null);
      if ((dCol !== 0 || dRow !== 0) && ids.length > 0) onMove(ids, dCol * ASCII_W, dRow * ASCII_H);
      return;
    }
    if (!startRef.current) return;
    const final = draftFor(startRef.current, cellAt(event.clientX, event.clientY));
    startRef.current = null;
    draftRef.current = null;
    setDraft(null);
    if (final) onAddShape(final);
  }, [cellAt, draftFor, onAddShape, onMove]);

  const onPointerCancel = useCallback(() => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    panRef.current = null;
    moveStartRef.current = null;
    moveIdsRef.current = [];
    moveDeltaRef.current = null;
    startRef.current = null;
    draftRef.current = null;
    setMoveDelta(null);
    setDraft(null);
  }, []);

  // Track spacebar (pan modifier).
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === "Space" && !(event.target instanceof HTMLInputElement)) spaceRef.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") spaceRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Track container size for a viewport-filling canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setSize({ w: container.clientWidth, h: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Wheel: pan by default, zoom (toward cursor) with ctrl/cmd. Native listener for preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const v = viewRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top - RULER;
        const zoom = clamp(v.zoom * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
        const worldX = (mx - v.panX) / v.zoom;
        const worldY = (my - v.panY) / v.zoom;
        setView({ zoom, panX: mx - worldX * zoom, panY: my - worldY * zoom });
      } else {
        setView({ ...v, panX: v.panX - event.deltaX, panY: v.panY - event.deltaY });
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(size.w * dpr);
    canvas.height = Math.ceil(size.h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { panX, panY, zoom } = view;
    const cw = CELL_W * zoom;
    const ch = CELL_H * zoom;
    const screenX = (col: number) => panX + col * cw;
    const screenY = (row: number) => RULER + panY + row * ch;

    drawGrid(context, size, view);

    const selected = new Set(selectedIds);
    const moved = moveDelta
      ? shapes.map((shape) => (selected.has(shape.id) ? translateShape(shape, moveDelta.dCol * ASCII_W, moveDelta.dRow * ASCII_H) : shape))
      : shapes;
    const renderShapes = draft ? [...moved, draft] : moved;

    // Dynamic bounds so the drawable area grows past the original frame.
    let maxX = canvasSize.width;
    let maxY = canvasSize.height;
    for (const shape of renderShapes) {
      const box = shapeAabb(shape);
      maxX = Math.max(maxX, box.x + box.width + ASCII_W * 2);
      maxY = Math.max(maxY, box.y + box.height + ASCII_H * 2);
    }
    const ascii = sceneToAscii(
      { canvas: { width: maxX, height: maxY, background: "#ffffff" }, shapes: renderShapes },
      { cellWidth: ASCII_W, cellHeight: ASCII_H }
    );

    context.font = `${Math.max(6, Math.round(BASE_FONT * zoom))}px "JetBrains Mono", Menlo, Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#e8eaed";
    const firstCol = Math.max(0, Math.floor((-panX) / cw));
    const firstRow = Math.max(0, Math.floor((-RULER - panY) / ch));
    ascii.split("\n").forEach((line, row) => {
      if (row < firstRow) return;
      const y = screenY(row);
      if (y < RULER - ch || y > size.h + ch) return;
      for (let col = firstCol; col < line.length; col += 1) {
        const char = line[col];
        if (char === " ") continue;
        const x = screenX(col);
        if (x < -cw) continue;
        if (x > size.w + cw) break;
        context.fillText(char, x + cw / 2, y + ch / 2);
      }
    });

    for (const shape of renderShapes) {
      if (!selected.has(shape.id)) continue;
      drawSelection(context, cellBounds(shape), screenX, screenY, cw, ch);
    }
  }, [canvasSize.height, canvasSize.width, draft, moveDelta, selectedIds, shapes, size, view]);

  const panning = spaceRef.current;
  return (
    <div ref={containerRef} className="gridViewport">
      <canvas
        ref={canvasRef}
        className="gridCanvas"
        style={{ width: size.w, height: size.h, cursor: panning ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
      />
      {textDraft && (
        <input
          autoFocus
          ref={textInputRef}
          aria-label="Grid text"
          className="gridTextInput"
          value={textDraft.value}
          onChange={(event) => { const value = event.target.value; setTextDraft((current) => current ? { ...current, value } : current); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); textIntentRef.current = "commit"; textInputRef.current?.blur(); }
            else if (event.key === "Escape") { event.preventDefault(); textIntentRef.current = "cancel"; textInputRef.current?.blur(); }
          }}
          onBlur={onTextBlur}
          style={{
            left: view.panX + textDraft.col * CELL_W * view.zoom,
            top: RULER + view.panY + textDraft.row * CELL_H * view.zoom,
            height: CELL_H * view.zoom
          }}
        />
      )}
    </div>
  );
}

function drawSelection(
  context: CanvasRenderingContext2D,
  bounds: { c0: number; r0: number; c1: number; r1: number },
  screenX: (col: number) => number,
  screenY: (row: number) => number,
  cw: number,
  ch: number
) {
  const pad = 2;
  const x = screenX(bounds.c0) - pad;
  const y = screenY(bounds.r0) - pad;
  const w = (bounds.c1 - bounds.c0 + 1) * cw + pad * 2;
  const h = (bounds.r1 - bounds.r0 + 1) * ch + pad * 2;
  context.save();
  context.strokeStyle = "#2563eb";
  context.lineWidth = 1.5;
  context.setLineDash([5, 4]);
  context.strokeRect(x, y, w, h);
  context.restore();
}

function drawGrid(context: CanvasRenderingContext2D, size: { w: number; h: number }, view: View) {
  const { panX, panY, zoom } = view;
  const cw = CELL_W * zoom;
  const ch = CELL_H * zoom;

  context.fillStyle = "#15171c";
  context.fillRect(0, 0, size.w, size.h);

  // dotted grid for the positive quadrant within view
  context.fillStyle = "#2b2f37";
  const startCol = Math.max(0, Math.floor((-panX) / cw));
  const startRow = Math.max(0, Math.floor((-RULER - panY) / ch));
  for (let col = startCol; ; col += 1) {
    const x = panX + col * cw;
    if (x > size.w) break;
    for (let row = startRow; ; row += 1) {
      const y = RULER + panY + row * ch;
      if (y > size.h) break;
      context.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }

  // top ruler
  context.fillStyle = "#222530";
  context.fillRect(0, 0, size.w, RULER);
  context.fillStyle = "#7a818c";
  context.font = "11px ui-sans-serif, -apple-system, system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  const step = rulerStep(zoom);
  for (let col = Math.max(0, Math.ceil((-panX) / cw / step) * step); ; col += step) {
    const x = panX + col * cw;
    if (x > size.w) break;
    context.fillRect(x, RULER - 6, 1, 6);
    context.fillText(String(col), x + 3, RULER / 2);
  }
}
