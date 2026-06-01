// MonoSketch-style ASCII renderer: rasterizes a NormalizedScene onto a character
// grid using box-drawing glyphs. Pure (no DOM/SVG/IO) so it is shared by the CLI.
import { resolveArrowPoints, type NormalizedScene, type Shape, type StrokeStyle } from "./spec";
import { layoutText } from "./text-layout";

export type AsciiOptions = {
  cellWidth?: number;
  cellHeight?: number;
};

const DEFAULT_CELL_WIDTH = 8;
const DEFAULT_CELL_HEIGHT = 16;

// Connection direction bits for a line cell.
const UP = 1;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 8;

// Stroke weight per cell: 1 single, 2 bold, 3 double (0 = not a line cell).
type Weight = 1 | 2 | 3;

const GLYPHS: Record<Weight, Record<number, string>> = {
  1: { 1: "│", 4: "│", 5: "│", 2: "─", 8: "─", 10: "─", 6: "┌", 12: "┐", 3: "└", 9: "┘", 7: "├", 13: "┤", 14: "┬", 11: "┴", 15: "┼" },
  2: { 1: "┃", 4: "┃", 5: "┃", 2: "━", 8: "━", 10: "━", 6: "┏", 12: "┓", 3: "┗", 9: "┛", 7: "┣", 13: "┫", 14: "┳", 11: "┻", 15: "╋" },
  3: { 1: "║", 4: "║", 5: "║", 2: "═", 8: "═", 10: "═", 6: "╔", 12: "╗", 3: "╚", 9: "╝", 7: "╠", 13: "╣", 14: "╦", 11: "╩", 15: "╬" }
};

// Rounded corners only apply to single-weight corner masks.
const ROUND_CORNERS: Record<number, string> = { 6: "╭", 12: "╮", 3: "╰", 9: "╯" };

const ARROW_HEADS: Record<number, string> = { [UP]: "▲", [RIGHT]: "▶", [DOWN]: "▼", [LEFT]: "◀" };

type Cell = { col: number; row: number };

type Grid = {
  cols: number;
  rows: number;
  chars: string[];
  dirs: Uint8Array;
  weights: Uint8Array;
};

export function sceneToAscii(scene: NormalizedScene, options: AsciiOptions = {}): string {
  const cellWidth = options.cellWidth && options.cellWidth > 0 ? options.cellWidth : DEFAULT_CELL_WIDTH;
  const cellHeight = options.cellHeight && options.cellHeight > 0 ? options.cellHeight : DEFAULT_CELL_HEIGHT;
  const cols = Math.max(1, Math.ceil(scene.canvas.width / cellWidth) + 1);
  const rows = Math.max(1, Math.ceil(scene.canvas.height / cellHeight) + 1);
  const grid: Grid = { cols, rows, chars: new Array(cols * rows).fill(" "), dirs: new Uint8Array(cols * rows), weights: new Uint8Array(cols * rows) };

  const toCol = (x: number) => Math.round(x / cellWidth);
  const toRow = (y: number) => Math.round(y / cellHeight);
  const byId = new Map(scene.shapes.map((shape) => [shape.id, shape]));

  for (const shape of scene.shapes) {
    if (shape.type === "rect") paintRect(grid, shape, toCol, toRow);
    else if (shape.type === "text") paintText(grid, shape, toCol, toRow);
    else if (shape.type === "arrow") paintArrow(grid, { ...shape, points: resolveArrowPoints(shape, byId) }, toCol, toRow);
    else paintPen(grid, shape, toCol, toRow);
  }

  return gridToString(grid);
}

function weightOf(style: StrokeStyle | undefined): Weight {
  return style === "double" ? 3 : style === "bold" ? 2 : 1;
}

function inBounds(grid: Grid, col: number, row: number): boolean {
  return col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;
}

function setChar(grid: Grid, col: number, row: number, char: string) {
  if (!inBounds(grid, col, row)) return;
  const index = row * grid.cols + col;
  grid.chars[index] = char;
  grid.dirs[index] = 0;
  grid.weights[index] = 0;
}

// Paint a line cell, merging with any existing line cell so overlaps form junctions.
function addLine(grid: Grid, col: number, row: number, dir: number, weight: Weight, rounded: boolean) {
  if (!inBounds(grid, col, row) || dir === 0) return;
  const index = row * grid.cols + col;
  const mergedDir = grid.dirs[index] | dir;
  const heavier = Math.max(grid.weights[index], weight);
  const mergedWeight: Weight = heavier === 2 ? 2 : heavier === 3 ? 3 : 1;
  grid.dirs[index] = mergedDir;
  grid.weights[index] = mergedWeight;
  grid.chars[index] = glyphFor(mergedDir, mergedWeight, rounded);
}

function glyphFor(dir: number, weight: Weight, rounded: boolean): string {
  if (rounded && weight === 1 && ROUND_CORNERS[dir]) return ROUND_CORNERS[dir];
  return GLYPHS[weight][dir] ?? " ";
}

function isStraight(dir: number): boolean {
  return dir === (UP | DOWN) || dir === (LEFT | RIGHT);
}

function paintRect(grid: Grid, rect: Extract<Shape, { type: "rect" }>, toCol: (x: number) => number, toRow: (y: number) => number) {
  const x0 = Math.min(rect.x, rect.x + rect.width);
  const y0 = Math.min(rect.y, rect.y + rect.height);
  const c0 = toCol(x0);
  const r0 = toRow(y0);
  const c1 = toCol(x0 + Math.abs(rect.width));
  const r1 = toRow(y0 + Math.abs(rect.height));
  const weight = weightOf(rect.strokeStyle);
  const rounded = rect.rounded === true;

  if (c1 <= c0 || r1 <= r0) {
    if (rect.label) placeLabel(grid, rect.label, c0, c1, r0, r0);
    return;
  }

  if (rect.fill) {
    const fillChar = rect.fill === "#111827" ? "█" : " ";
    for (let row = r0 + 1; row < r1; row += 1) for (let col = c0 + 1; col < c1; col += 1) setChar(grid, col, row, fillChar);
  }

  const dash = rect.dashed === true;
  for (let col = c0 + 1; col < c1; col += 1) {
    if (!dash || col % 2 === 0) {
      addLine(grid, col, r0, LEFT | RIGHT, weight, rounded);
      addLine(grid, col, r1, LEFT | RIGHT, weight, rounded);
    }
  }
  for (let row = r0 + 1; row < r1; row += 1) {
    if (!dash || row % 2 === 0) {
      addLine(grid, c0, row, UP | DOWN, weight, rounded);
      addLine(grid, c1, row, UP | DOWN, weight, rounded);
    }
  }
  addLine(grid, c0, r0, DOWN | RIGHT, weight, rounded);
  addLine(grid, c1, r0, DOWN | LEFT, weight, rounded);
  addLine(grid, c0, r1, UP | RIGHT, weight, rounded);
  addLine(grid, c1, r1, UP | LEFT, weight, rounded);

  if (rect.label) placeLabel(grid, rect.label, c0, c1, r0, r1);
}

function placeLabel(grid: Grid, label: string, c0: number, c1: number, r0: number, r1: number) {
  const innerLeft = c0 + 1;
  const maxCols = Math.max(0, c1 - c0 - 1);
  if (maxCols <= 0) return;
  const text = label.length > maxCols ? label.slice(0, maxCols) : label;
  const start = innerLeft + Math.floor((maxCols - text.length) / 2);
  const row = Math.floor((r0 + r1) / 2);
  for (let i = 0; i < text.length; i += 1) setChar(grid, start + i, row, text[i]);
}

function paintText(grid: Grid, text: Extract<Shape, { type: "text" }>, toCol: (x: number) => number, toRow: (y: number) => number) {
  const layout = layoutText(text);
  const startCol = toCol(layout.x);
  const startRow = toRow(text.y);
  layout.lines.forEach((line, i) => {
    for (let c = 0; c < line.length; c += 1) setChar(grid, startCol + c, startRow + i, line[c]);
  });
}

function paintArrow(grid: Grid, arrow: Extract<Shape, { type: "arrow" }>, toCol: (x: number) => number, toRow: (y: number) => number) {
  const cells: Cell[] = [];
  for (let i = 0; i + 1 < arrow.points.length; i += 2) cells.push({ col: toCol(arrow.points[i]), row: toRow(arrow.points[i + 1]) });
  const path = expandPath(cells);
  if (path.length === 0) return;
  const weight = weightOf(arrow.strokeStyle);
  const dash = arrow.dashed === true;

  for (let j = 0; j < path.length; j += 1) {
    let dir = 0;
    if (j > 0) dir |= dirToward(path[j], path[j - 1]);
    if (j < path.length - 1) dir |= dirToward(path[j], path[j + 1]);
    if (dash && isStraight(dir) && j % 2 === 1) continue;
    addLine(grid, path[j].col, path[j].row, dir, weight, false);
  }

  const head = path.length > 1 ? ARROW_HEADS[dirToward(path[path.length - 2], path[path.length - 1])] : undefined;
  if (head) setChar(grid, path[path.length - 1].col, path[path.length - 1].row, head);
  if (arrow.label) {
    const mid = path[Math.floor(path.length / 2)];
    placeFloatingLabel(grid, arrow.label, mid.col, mid.row - 1);
  }
}

function paintPen(grid: Grid, pen: Extract<Shape, { type: "pen" }>, toCol: (x: number) => number, toRow: (y: number) => number) {
  const cells: Cell[] = [];
  for (let i = 0; i + 1 < pen.points.length; i += 2) cells.push({ col: toCol(pen.points[i]), row: toRow(pen.points[i + 1]) });
  const path = expandPath(cells);
  for (let j = 0; j < path.length; j += 1) {
    let dir = 0;
    if (j > 0) dir |= dirToward(path[j], path[j - 1]);
    if (j < path.length - 1) dir |= dirToward(path[j], path[j + 1]);
    addLine(grid, path[j].col, path[j].row, dir, 1, false);
  }
}

function placeFloatingLabel(grid: Grid, label: string, midCol: number, row: number) {
  const start = midCol - Math.floor(label.length / 2);
  for (let i = 0; i < label.length; i += 1) setChar(grid, start + i, row, label[i]);
}

// Expand corner points into a contiguous run of unit-step cells, inserting an elbow
// (horizontal then vertical) between diagonal pairs.
function expandPath(cells: Cell[]): Cell[] {
  const distinct = cells.filter((cell, i) => i === 0 || cell.col !== cells[i - 1].col || cell.row !== cells[i - 1].row);
  if (distinct.length === 0) return [];
  const out: Cell[] = [distinct[0]];
  for (let i = 1; i < distinct.length; i += 1) {
    const target = distinct[i];
    stepTo(out, { col: target.col, row: out[out.length - 1].row });
    stepTo(out, target);
  }
  return out;
}

function stepTo(out: Cell[], to: Cell) {
  let current = out[out.length - 1];
  while (current.col !== to.col || current.row !== to.row) {
    current = { col: current.col + Math.sign(to.col - current.col), row: current.row + Math.sign(to.row - current.row) };
    out.push(current);
  }
}

function dirToward(from: Cell, to: Cell): number {
  if (to.row < from.row) return UP;
  if (to.row > from.row) return DOWN;
  if (to.col > from.col) return RIGHT;
  if (to.col < from.col) return LEFT;
  return 0;
}

function gridToString(grid: Grid): string {
  const lines: string[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    lines.push(grid.chars.slice(row * grid.cols, row * grid.cols + grid.cols).join("").replace(/\s+$/, ""));
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
