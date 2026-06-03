import { layoutText } from "./text-layout";

export type DrawColor = "#e11d48" | "#f59e0b" | "#10b981" | "#2563eb" | "#111827" | "#ffffff";

export type Tool = "select" | "pen" | "highlighter" | "arrow" | "line" | "rect" | "text" | "redact";

export type PointTuple = [number, number];

export type BaseShape = {
  id: string;
  color: DrawColor;
  strokeWidth: number;
  angle?: number;
};

export type PenShape = BaseShape & {
  type: "pen";
  points: number[];
  opacity?: number;
};

export type Binding = {
  shapeId: string;
  ratio: [number, number];
};

// ASCII-only styling (ignored by the pixel/SVG renderers). Lets a scene opt into
// MonoSketch-style box-drawing weights, rounded corners, dashed strokes, and fills.
export type StrokeStyle = "none" | "single" | "bold" | "double";

export type FillStyle = "none" | "solid" | "shade" | "dense" | "half";

export type ArrowShape = BaseShape & {
  type: "arrow";
  points: number[];
  label?: string;
  startBinding?: Binding;
  endBinding?: Binding;
  strokeStyle?: StrokeStyle;
  dashed?: boolean;
  // A plain line is an arrow with the head suppressed; absent/true keeps the arrowhead.
  arrowhead?: boolean;
};

export type RectShape = BaseShape & {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  label?: string;
  strokeStyle?: StrokeStyle;
  fillStyle?: FillStyle;
  rounded?: boolean;
  dashed?: boolean;
};

export type TextShape = BaseShape & {
  type: "text";
  x: number;
  y: number;
  text: string;
  originalText?: string;
  width?: number;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  autoResize?: boolean;
  containerId?: string;
};

export type Shape = PenShape | ArrowShape | RectShape | TextShape;

export type SceneCanvas = {
  width: number;
  height: number;
  background?: string;
};

type NamedColor = "red" | "orange" | "green" | "blue" | "dark" | "white" | "black" | "yellow";

type CommonSpec = {
  id?: string;
  color?: NamedColor | DrawColor | string;
  strokeWidth?: number;
  opacity?: number;
  angle?: number;
};

export type SceneRectSpec = CommonSpec & {
  type: "rect" | "redact";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: NamedColor | DrawColor | string;
  label?: string;
  strokeStyle?: StrokeStyle;
  fillStyle?: FillStyle;
  rounded?: boolean;
  dashed?: boolean;
};

export type SceneArrowSpec = CommonSpec & {
  type: "arrow";
  from?: PointTuple;
  to?: PointTuple;
  points?: number[];
  label?: string;
  startBinding?: Binding;
  endBinding?: Binding;
  strokeStyle?: StrokeStyle;
  dashed?: boolean;
  arrowhead?: boolean;
};

export type SceneTextSpec = CommonSpec & {
  type: "text";
  x: number;
  y: number;
  text: string;
  originalText?: string;
  width?: number;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  autoResize?: boolean;
  containerId?: string;
};

export type ScenePenSpec = CommonSpec & {
  type: "pen" | "highlight" | "highlighter";
  points: number[];
};

export type SceneShapeSpec = SceneRectSpec | SceneArrowSpec | SceneTextSpec | ScenePenSpec;

export type SceneSpec = {
  canvas?: Partial<SceneCanvas>;
  shapes?: SceneShapeSpec[];
};

export type NormalizedScene = {
  canvas: SceneCanvas;
  shapes: Shape[];
};

export type NormalizeSceneOptions = {
  canvasFallback?: Partial<SceneCanvas>;
};

export const namedColors: Record<NamedColor, DrawColor> = {
  red: "#e11d48",
  orange: "#f59e0b",
  yellow: "#f59e0b",
  green: "#10b981",
  blue: "#2563eb",
  dark: "#111827",
  black: "#111827",
  white: "#ffffff"
};

export const defaultCanvas: SceneCanvas = {
  width: 960,
  height: 620,
  background: "#ffffff"
};

export function isSceneSpec(value: unknown): value is SceneSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const spec = value as Record<string, unknown>;
  if ("adapter" in spec || "source" in spec) return false;
  if (!("canvas" in spec) && !("shapes" in spec)) return false;
  if (spec.canvas !== undefined && (!spec.canvas || typeof spec.canvas !== "object" || Array.isArray(spec.canvas))) return false;
  return spec.shapes === undefined || Array.isArray(spec.shapes);
}

export function colorFor(value: unknown, fallback: DrawColor = "#2563eb"): DrawColor {
  if (typeof value !== "string") return fallback;
  if (value in namedColors) return namedColors[value as NamedColor];
  if (isDrawColor(value)) return value;
  return fallback;
}

export function normalizeScene(input: unknown, options: NormalizeSceneOptions = {}): NormalizedScene {
  if (!isSceneSpec(input)) throw new Error("scene spec must be a JSON object");
  const canvas = normalizeCanvas(input.canvas, options.canvasFallback);
  const shapes = (Array.isArray(input.shapes) ? input.shapes : []).flatMap((shape, index) => normalizeShape(shape, index));
  return { canvas, shapes };
}

export function sceneFromShapes(canvas: SceneCanvas, shapes: Shape[]): NormalizedScene {
  return {
    canvas: normalizeCanvas(canvas),
    shapes: shapes.map((shape, index) => ({ ...shape, id: shape.id || stableId(index) }))
  };
}

function normalizeCanvas(canvas: Partial<SceneCanvas> | undefined, fallback: Partial<SceneCanvas> = defaultCanvas): SceneCanvas {
  return {
    width: positiveNumber(canvas?.width, positiveNumber(fallback.width, defaultCanvas.width)),
    height: positiveNumber(canvas?.height, positiveNumber(fallback.height, defaultCanvas.height)),
    background: typeof canvas?.background === "string" ? canvas.background : typeof fallback.background === "string" ? fallback.background : defaultCanvas.background
  };
}

function normalizeShape(shape: SceneShapeSpec, index: number): Shape[] {
  if (!shape || typeof shape !== "object" || typeof shape.type !== "string") {
    throw new Error(`shape ${index} must include a type`);
  }
  const id = shape.id ?? stableId(index);
  const strokeWidth = positiveNumber(shape.strokeWidth, shape.type === "highlighter" || shape.type === "highlight" ? 18 : 4);
  const color = colorFor(shape.color, shape.type === "highlighter" || shape.type === "highlight" ? "#f59e0b" : "#2563eb");
  const angle = finiteNumber(shape.angle, 0);

  if (shape.type === "rect" || shape.type === "redact") {
    const rect: RectShape = {
      id,
      type: "rect",
      x: numberValue(shape.x, `shape ${index}.x`),
      y: numberValue(shape.y, `shape ${index}.y`),
      width: numberValue(shape.width, `shape ${index}.width`),
      height: numberValue(shape.height, `shape ${index}.height`),
      color: shape.type === "redact" ? "#111827" : color,
      angle,
      strokeWidth,
      fill: shape.type === "redact" ? "#111827" : typeof shape.fill === "string" ? colorFor(shape.fill, color) : undefined,
      label: textValue(shape.label)
    };
    const strokeStyle = strokeStyleValue(shape.strokeStyle);
    if (strokeStyle) rect.strokeStyle = strokeStyle;
    const fillStyle = fillStyleValue(shape.fillStyle);
    if (fillStyle) rect.fillStyle = fillStyle;
    if (shape.rounded === true) rect.rounded = true;
    if (shape.dashed === true) rect.dashed = true;
    return [rect];
  }

  if (shape.type === "arrow") {
    const points = Array.isArray(shape.points)
      ? normalizePoints(shape.points, index)
      : [...pointTuple(shape.from, `shape ${index}.from`), ...pointTuple(shape.to, `shape ${index}.to`)];
    const arrow: ArrowShape = { id, type: "arrow", points, color, angle, strokeWidth, label: textValue(shape.label) };
    const startBinding = normalizeBinding(shape.startBinding);
    const endBinding = normalizeBinding(shape.endBinding);
    if (startBinding) arrow.startBinding = startBinding;
    if (endBinding) arrow.endBinding = endBinding;
    const arrowStroke = strokeStyleValue(shape.strokeStyle);
    if (arrowStroke) arrow.strokeStyle = arrowStroke;
    if (shape.dashed === true) arrow.dashed = true;
    if (shape.arrowhead === false) arrow.arrowhead = false;
    return [arrow];
  }

  if (shape.type === "text") {
    const text = textValue(shape.text);
    if (!text) throw new Error(`shape ${index}.text must be a non-empty string`);
    return [{
      id,
      type: "text",
      x: numberValue(shape.x, `shape ${index}.x`),
      y: numberValue(shape.y, `shape ${index}.y`),
      text,
      originalText: rawTextValue(shape.originalText),
      width: optionalPositiveNumber(shape.width),
      color,
      angle,
      strokeWidth,
      fontSize: positiveNumber(shape.fontSize, 28),
      fontFamily: shape.fontFamily,
      textAlign: shape.textAlign,
      verticalAlign: shape.verticalAlign,
      lineHeight: positiveNumber(shape.lineHeight, 1.24),
      autoResize: typeof shape.autoResize === "boolean" ? shape.autoResize : shape.width === undefined,
      containerId: textValue(shape.containerId)
    }];
  }

  if (shape.type === "pen" || shape.type === "highlight" || shape.type === "highlighter") {
    return [{
      id,
      type: "pen",
      points: normalizePoints(shape.points, index),
      color,
      angle,
      strokeWidth,
      opacity: shape.type === "pen" ? shape.opacity : shape.opacity ?? 0.35
    }];
  }

  throw new Error(`unsupported shape type: ${(shape as { type: string }).type}`);
}

// --- Arrow connectors (MonoSketch-style: attachment stored as a normalized [0..1]
// ratio inside the target's axis-aligned bounding box, re-resolved when it moves). ---

export type Aabb = { x: number; y: number; width: number; height: number };

export function shapeAabb(shape: Shape): Aabb {
  if (shape.type === "rect") {
    return {
      x: Math.min(shape.x, shape.x + shape.width),
      y: Math.min(shape.y, shape.y + shape.height),
      width: Math.abs(shape.width),
      height: Math.abs(shape.height)
    };
  }
  if (shape.type === "text") {
    const layout = layoutText(shape);
    return { x: layout.x, y: shape.y, width: layout.width, height: layout.height };
  }
  const xs = shape.points.filter((_, pointIndex) => pointIndex % 2 === 0);
  const ys = shape.points.filter((_, pointIndex) => pointIndex % 2 === 1);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function anchorPoint(binding: Binding | undefined, byId: Map<string, Shape>): PointTuple | undefined {
  if (!binding) return undefined;
  const target = byId.get(binding.shapeId);
  // Only rect/text are valid connector targets (matches bindingFor); ignore anything
  // else, including a crafted self-binding to the arrow itself.
  if (!target || (target.type !== "rect" && target.type !== "text")) return undefined;
  const box = shapeAabb(target);
  return [box.x + box.width * binding.ratio[0], box.y + box.height * binding.ratio[1]];
}

// Resolve an arrow's effective points: bound ends snap to their target's anchor,
// unbound ends fall through to the stored points. Missing targets are ignored.
export function resolveArrowPoints(arrow: ArrowShape, byId: Map<string, Shape>): number[] {
  const points = [...arrow.points];
  if (points.length < 4) return points;
  const start = anchorPoint(arrow.startBinding, byId);
  if (start) [points[0], points[1]] = start;
  const end = anchorPoint(arrow.endBinding, byId);
  if (end) [points[points.length - 2], points[points.length - 1]] = end;
  return points;
}

// Topmost rect/text shape whose AABB contains the point, as a normalized binding.
export function bindingFor(point: PointTuple, shapes: Shape[]): Binding | undefined {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];
    if (shape.type !== "rect" && shape.type !== "text") continue;
    const box = shapeAabb(shape);
    if (point[0] < box.x || point[0] > box.x + box.width || point[1] < box.y || point[1] > box.y + box.height) continue;
    return {
      shapeId: shape.id,
      ratio: [box.width === 0 ? 0 : (point[0] - box.x) / box.width, box.height === 0 ? 0 : (point[1] - box.y) / box.height]
    };
  }
  return undefined;
}

// Re-resolve every bound arrow's points against current shape positions. Arrows in
// `skip` (e.g. ones being dragged directly) keep their stored points.
export function reflowBoundArrows(shapes: Shape[], skip?: Set<string>): Shape[] {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  return shapes.map((shape) => {
    if (shape.type !== "arrow" || (!shape.startBinding && !shape.endBinding) || skip?.has(shape.id)) return shape;
    const points = resolveArrowPoints(shape, byId);
    return samePoints(points, shape.points) ? shape : { ...shape, points };
  });
}

function samePoints(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeBinding(value: unknown): Binding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const binding = value as Record<string, unknown>;
  if (typeof binding.shapeId !== "string" || !binding.shapeId) return undefined;
  if (!Array.isArray(binding.ratio) || binding.ratio.length !== 2) return undefined;
  const [rx, ry] = binding.ratio;
  if (typeof rx !== "number" || !Number.isFinite(rx) || typeof ry !== "number" || !Number.isFinite(ry)) return undefined;
  return { shapeId: binding.shapeId, ratio: [clamp01(rx), clamp01(ry)] };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function strokeStyleValue(value: unknown): StrokeStyle | undefined {
  return value === "none" || value === "single" || value === "bold" || value === "double" ? value : undefined;
}

function fillStyleValue(value: unknown): FillStyle | undefined {
  return value === "none" || value === "solid" || value === "shade" || value === "dense" || value === "half" ? value : undefined;
}

function pointTuple(value: unknown, field: string): PointTuple {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${field} must be [x, y]`);
  return [numberValue(value[0], `${field}[0]`), numberValue(value[1], `${field}[1]`)];
}

function normalizePoints(points: unknown, index: number): number[] {
  if (!Array.isArray(points) || points.length < 4 || points.length % 2 !== 0) {
    throw new Error(`shape ${index}.points must contain x/y pairs`);
  }
  return points.map((value, pointIndex) => numberValue(value, `shape ${index}.points[${pointIndex}]`));
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rawTextValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stableId(index: number) {
  return `shape-${index + 1}`;
}

function isDrawColor(value: string): value is DrawColor {
  return value === "#e11d48" || value === "#f59e0b" || value === "#10b981" || value === "#2563eb" || value === "#111827" || value === "#ffffff";
}
