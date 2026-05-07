export type Tool = "select" | "pen" | "highlighter" | "arrow" | "rect" | "text" | "redact";

export type DrawColor = "#e11d48" | "#f59e0b" | "#10b981" | "#2563eb" | "#111827" | "#ffffff";

export type Point = {
  x: number;
  y: number;
};

export type BaseShape = {
  id: string;
  color: DrawColor;
  strokeWidth: number;
};

export type PenShape = BaseShape & {
  type: "pen";
  points: number[];
  opacity?: number;
};

export type ArrowShape = BaseShape & {
  type: "arrow";
  points: number[];
};

export type RectShape = BaseShape & {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
};

export type TextShape = BaseShape & {
  type: "text";
  x: number;
  y: number;
  text: string;
};

export type Shape = PenShape | ArrowShape | RectShape | TextShape;
