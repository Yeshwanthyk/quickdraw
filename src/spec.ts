export type DrawColor = "#e11d48" | "#f59e0b" | "#10b981" | "#2563eb" | "#111827" | "#ffffff";

export type Tool = "select" | "pen" | "highlighter" | "arrow" | "rect" | "text" | "redact";

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

export type ArrowShape = BaseShape & {
  type: "arrow";
  points: number[];
  label?: string;
};

export type RectShape = BaseShape & {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  label?: string;
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
};

export type SceneArrowSpec = CommonSpec & {
  type: "arrow";
  from?: PointTuple;
  to?: PointTuple;
  points?: number[];
  label?: string;
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
    return [rect];
  }

  if (shape.type === "arrow") {
    const points = Array.isArray(shape.points)
      ? normalizePoints(shape.points, index)
      : [...pointTuple(shape.from, `shape ${index}.from`), ...pointTuple(shape.to, `shape ${index}.to`)];
    const arrow: ArrowShape = { id, type: "arrow", points, color, angle, strokeWidth, label: textValue(shape.label) };
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
