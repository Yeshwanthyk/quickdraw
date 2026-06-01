import { useCallback, useEffect, useRef, useState } from "react";
import { sceneToAscii } from "../../src/ascii";
import type { DrawColor, Shape, Tool } from "../tools/types";

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
  onAddShape: (shape: Shape) => void;
};

type Cell = { col: number; row: number };

function shapeId() {
  return crypto.randomUUID();
}

export function GridMode(props: GridModeProps) {
  const { canvasSize, shapes, tool, color, strokeWidth, onAddShape } = props;
  const cols = Math.max(1, Math.floor(canvasSize.width / ASCII_W));
  const rows = Math.max(1, Math.floor(canvasSize.height / ASCII_H));
  const width = cols * CELL_W;
  const height = RULER + rows * CELL_H;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const startRef = useRef<Cell | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const rafRef = useRef<number | null>(null);

  const cellAt = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Cell => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.round((event.clientX - rect.left) / CELL_W);
    const row = Math.round((event.clientY - rect.top - RULER) / CELL_H);
    return { col: clamp(col, 0, cols), row: clamp(row, 0, rows) };
  }, [cols, rows]);

  const draftFor = useCallback((start: Cell, end: Cell): Shape | null => {
    if (tool === "rect" || tool === "redact") {
      const x = Math.min(start.col, end.col) * ASCII_W;
      const y = Math.min(start.row, end.row) * ASCII_H;
      const w = Math.abs(end.col - start.col) * ASCII_W;
      const h = Math.abs(end.row - start.row) * ASCII_H;
      if (w === 0 || h === 0) return null;
      return { id: shapeId(), type: "rect", x, y, width: w, height: h, color: tool === "redact" ? "#111827" : color, strokeWidth, fill: tool === "redact" ? "#111827" : undefined };
    }
    if (tool === "arrow") {
      if (start.col === end.col && start.row === end.row) return null;
      return { id: shapeId(), type: "arrow", points: [start.col * ASCII_W, start.row * ASCII_H, end.col * ASCII_W, end.row * ASCII_H], color, strokeWidth };
    }
    return null;
  }, [color, strokeWidth, tool]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== "rect" && tool !== "redact" && tool !== "arrow") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = cellAt(event);
  }, [cellAt, tool]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!startRef.current) return;
    draftRef.current = draftFor(startRef.current, cellAt(event));
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setDraft(draftRef.current);
    });
  }, [cellAt, draftFor]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!startRef.current) return;
    const final = draftFor(startRef.current, cellAt(event));
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    draftRef.current = null;
    setDraft(null);
    if (final) onAddShape(final);
  }, [cellAt, draftFor, onAddShape]);

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

    const ascii = sceneToAscii(
      { canvas: { width: canvasSize.width, height: canvasSize.height, background: "#ffffff" }, shapes: draft ? [...shapes, draft] : shapes },
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
  }, [canvasSize.height, canvasSize.width, cols, draft, height, rows, shapes, width]);

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
        />
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
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
