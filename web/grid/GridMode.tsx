import { useCallback, useEffect, useRef, useState } from "react";
import { sceneToAscii } from "../../src/ascii";
import { shapeAabb } from "../../src/spec";
import type { DrawColor, Shape, Tool } from "../tools/types";
import type { GridStyle } from "./AppearancePanel";

// Logical ASCII cell (matches sceneToAscii defaults): 1 char = 8x16 scene px.
const ASCII_W = 8;
const ASCII_H = 16;
// On-screen size of one grid cell.
const CELL_W = 12;
const CELL_H = 22;
const RULER = 22;
// Advance width of a monospace glyph is ~0.6*fontSize, so size the font to the cell
// width (12 / 0.6 = 20) — otherwise box-drawing runs leave gaps and look dashed.
const FONT = 20;

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

function shapeId() {
  return crypto.randomUUID();
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

export function GridMode(props: GridModeProps) {
  const { canvasSize, shapes, tool, color, strokeWidth, style, selectedIds, onAddShape, onSelect, onMove } = props;
  const cols = Math.max(1, Math.floor(canvasSize.width / ASCII_W));
  const rows = Math.max(1, Math.floor(canvasSize.height / ASCII_H));
  const width = cols * CELL_W;
  const height = RULER + rows * CELL_H;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const textIntentRef = useRef<"commit" | "cancel" | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [moveDelta, setMoveDelta] = useState<Delta | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const startRef = useRef<Cell | null>(null);
  const moveStartRef = useRef<Cell | null>(null);
  const moveIdsRef = useRef<string[]>([]);
  const draftRef = useRef<Shape | null>(null);
  const moveDeltaRef = useRef<Delta | null>(null);
  const rafRef = useRef<number | null>(null);

  const cellAt = useCallback((event: React.MouseEvent<HTMLCanvasElement>): Cell => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.round((event.clientX - rect.left) / CELL_W);
    const row = Math.round((event.clientY - rect.top - RULER) / CELL_H);
    return { col: clamp(col, 0, cols), row: clamp(row, 0, rows) };
  }, [cols, rows]);

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
      // Redact stays an opaque solid block; it ignores the appearance panel.
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
      // "none"/"single" both map to the renderer's default arrow weight (a borderless
      // arrow is not meaningful); only bold/double change it.
      return {
        id: shapeId(), type: "arrow", points: [start.col * ASCII_W, start.row * ASCII_H, end.col * ASCII_W, end.row * ASCII_H], color, strokeWidth,
        ...(style.border === "bold" || style.border === "double" ? { strokeStyle: style.border } : {}),
        ...(style.dashed ? { dashed: true } : {})
      };
    }
    return null;
  }, [color, strokeWidth, style, tool]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = cellAt(event);
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

  // Text entry opens on click (not pointerdown) so the mousedown's focus-steal from the
  // non-focusable canvas can't immediately blur and close the freshly-focused input.
  const onClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text") return;
    const cell = cellAt(event);
    setTextDraft({ col: cell.col, row: cell.row, value: "" });
  }, [cellAt, tool]);

  // onBlur is the single source of truth for ending text entry. Enter/Escape just blur
  // the input (setting intent), so the unmount can't re-fire a second commit.
  const onTextBlur = useCallback(() => {
    const intent = textIntentRef.current;
    textIntentRef.current = null;
    if (intent !== "cancel" && textDraft && textDraft.value.trim()) {
      onAddShape({ id: shapeId(), type: "text", x: textDraft.col * ASCII_W, y: textDraft.row * ASCII_H, text: textDraft.value, color, strokeWidth });
    }
    setTextDraft(null);
  }, [color, onAddShape, strokeWidth, textDraft]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (moveStartRef.current) {
      const cell = cellAt(event);
      moveDeltaRef.current = { dCol: cell.col - moveStartRef.current.col, dRow: cell.row - moveStartRef.current.row };
      scheduleRender();
      return;
    }
    if (!startRef.current) return;
    draftRef.current = draftFor(startRef.current, cellAt(event));
    scheduleRender();
  }, [cellAt, draftFor, scheduleRender]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (moveStartRef.current) {
      const cell = cellAt(event);
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
    const final = draftFor(startRef.current, cellAt(event));
    startRef.current = null;
    draftRef.current = null;
    setDraft(null);
    if (final) onAddShape(final);
  }, [cellAt, draftFor, onAddShape, onMove]);

  // Reset all in-flight gesture state if the browser interrupts the pointer.
  const onPointerCancel = useCallback(() => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    moveStartRef.current = null;
    moveIdsRef.current = [];
    moveDeltaRef.current = null;
    startRef.current = null;
    draftRef.current = null;
    setMoveDelta(null);
    setDraft(null);
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
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(context, { width, height, cols, rows });

    const selected = new Set(selectedIds);
    const moved = moveDelta
      ? shapes.map((shape) => (selected.has(shape.id) ? translateShape(shape, moveDelta.dCol * ASCII_W, moveDelta.dRow * ASCII_H) : shape))
      : shapes;
    const renderShapes = draft ? [...moved, draft] : moved;

    const ascii = sceneToAscii(
      { canvas: { width: canvasSize.width, height: canvasSize.height, background: "#ffffff" }, shapes: renderShapes },
      { cellWidth: ASCII_W, cellHeight: ASCII_H }
    );
    context.font = `${FONT}px "JetBrains Mono", Menlo, Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#e8eaed";
    ascii.split("\n").forEach((line, row) => {
      for (let col = 0; col < line.length; col += 1) {
        const char = line[col];
        if (char === " ") continue;
        context.fillText(char, col * CELL_W + CELL_W / 2, RULER + row * CELL_H + CELL_H / 2);
      }
    });

    for (const shape of renderShapes) {
      if (!selected.has(shape.id)) continue;
      drawSelection(context, cellBounds(shape));
    }
  }, [canvasSize.height, canvasSize.width, cols, draft, height, moveDelta, rows, selectedIds, shapes, width]);

  return (
    <section className="canvasRail">
      <div className="canvasFrame gridFrame" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          className="gridCanvas"
          style={{ width, height }}
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
            style={{ left: textDraft.col * CELL_W, top: RULER + textDraft.row * CELL_H, height: CELL_H }}
          />
        )}
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function drawSelection(context: CanvasRenderingContext2D, bounds: { c0: number; r0: number; c1: number; r1: number }) {
  const x = bounds.c0 * CELL_W - 3;
  const y = RULER + bounds.r0 * CELL_H - 3;
  const w = (bounds.c1 - bounds.c0) * CELL_W + 6;
  const h = (bounds.r1 - bounds.r0) * CELL_H + 6;
  context.save();
  context.strokeStyle = "#2563eb";
  context.lineWidth = 1.5;
  context.setLineDash([5, 4]);
  context.strokeRect(x, y, w, h);
  context.restore();
}

function drawGrid(context: CanvasRenderingContext2D, size: { width: number; height: number; cols: number; rows: number }) {
  context.fillStyle = "#15171c";
  context.fillRect(0, 0, size.width, size.height);

  // dotted grid
  context.fillStyle = "#2b2f37";
  for (let col = 0; col <= size.cols; col += 1) {
    for (let row = 0; row <= size.rows; row += 1) {
      context.fillRect(col * CELL_W - 0.5, RULER + row * CELL_H - 0.5, 1, 1);
    }
  }

  // top ruler ticks + labels every 10 cells
  context.fillStyle = "#222530";
  context.fillRect(0, 0, size.width, RULER);
  context.fillStyle = "#7a818c";
  context.font = "11px ui-sans-serif, -apple-system, system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (let col = 0; col <= size.cols; col += 10) {
    context.fillRect(col * CELL_W, RULER - 6, 1, 6);
    if (col > 0) context.fillText(String(col), col * CELL_W + 3, RULER / 2);
  }
}
