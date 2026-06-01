import { AlignCenter, AlignLeft, AlignRight, ArrowRight, BringToFront, Check, Highlighter, MousePointer2, PenLine, Redo2, ScanLine, SendToBack, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText } from "react-konva";
import type Konva from "konva";
import { createHistory, pushHistory, redoHistory, undoHistory } from "./canvas/history";
import { TextEditor, type TextDraft } from "./canvas/TextEditor";
import { useImageSource } from "./canvas/useImageSource";
import { bindingFor, normalizeScene, reflowBoundArrows, sceneFromShapes } from "../src/spec";
import { layoutText } from "../src/text-layout";
import type { DrawColor, Shape, TextShape, Tool } from "./tools/types";

const colors: DrawColor[] = ["#e11d48", "#f59e0b", "#10b981", "#2563eb", "#111827", "#ffffff"];
const widths = [2, 4, 8, 14];
const fontSizes = [16, 20, 28, 40, 56];
const fontFamilies = [
  { label: "System", value: undefined },
  { label: "Arial", value: "Arial" },
  { label: "Mono", value: "Menlo, Monaco, Consolas, monospace" }
];
const toolShortcuts: Record<string, Tool> = {
  "1": "select",
  "2": "pen",
  "3": "highlighter",
  "4": "arrow",
  "5": "rect",
  "6": "text",
  "7": "redact"
};
const handleSize = 10;
const rotateHandleOffset = 34;
const resizeHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

type Bounds = { x: number; y: number; width: number; height: number };
type ResizeHandle = typeof resizeHandles[number];
type TransformPreview =
  | { kind: "move"; ids: string[]; dx: number; dy: number }
  | { kind: "resize"; id: string; from: Bounds; to: Bounds }
  | { kind: "rotate"; id: string; angle: number }
  | { kind: "arrow-points"; id: string; points: number[] };

function shapeId() {
  return crypto.randomUUID();
}

function normalizeRect(shape: Extract<Shape, { type: "rect" }>) {
  return {
    ...shape,
    x: Math.min(shape.x, shape.x + shape.width),
    y: Math.min(shape.y, shape.y + shape.height),
    width: Math.abs(shape.width),
    height: Math.abs(shape.height)
  };
}

function translateShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.type === "pen" || shape.type === "arrow") {
    return { ...shape, points: shape.points.map((value, index) => value + (index % 2 === 0 ? dx : dy)) };
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

function shapeBounds(shape: Shape): Bounds {
  if (shape.type === "pen" || shape.type === "arrow") {
    const xs = shape.points.filter((_, index) => index % 2 === 0);
    const ys = shape.points.filter((_, index) => index % 2 === 1);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  }
  if (shape.type === "rect") {
    const rect = normalizeRect(shape);
    return { x: rect.x, y: rect.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }
  const text = textMetrics(shape);
  return { x: text.x, y: shape.y, width: text.width, height: Math.max(1, text.height) };
}

function selectionBounds(shape: Shape) {
  const bounds = shapeBounds(shape);
  const pad = Math.max(shape.strokeWidth, 8);
  return { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 };
}

function textMetrics(shape: Extract<Shape, { type: "text" }>) {
  return layoutText(shape);
}

function handlePoint(bounds: Bounds, handle: ResizeHandle) {
  const x = handle.includes("w") ? bounds.x : handle.includes("e") ? bounds.x + bounds.width : bounds.x + bounds.width / 2;
  const y = handle.includes("n") ? bounds.y : handle.includes("s") ? bounds.y + bounds.height : bounds.y + bounds.height / 2;
  return { x, y };
}

function resizeBounds(bounds: Bounds, handle: ResizeHandle, point: { x: number; y: number }, keepAspect: boolean): Bounds {
  const next = { ...bounds };
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  if (handle.includes("w")) {
    next.x = Math.min(point.x, right - 1);
    next.width = right - next.x;
  }
  if (handle.includes("e")) next.width = Math.max(1, point.x - bounds.x);
  if (handle.includes("n")) {
    next.y = Math.min(point.y, bottom - 1);
    next.height = bottom - next.y;
  }
  if (handle.includes("s")) next.height = Math.max(1, point.y - bounds.y);
  if (!keepAspect || !handle.includes("n") && !handle.includes("s") || !handle.includes("w") && !handle.includes("e")) return next;

  const ratio = bounds.width / bounds.height;
  if (next.width / next.height > ratio) next.width = next.height * ratio;
  else next.height = next.width / ratio;
  if (handle.includes("w")) next.x = right - next.width;
  if (handle.includes("n")) next.y = bottom - next.height;
  return next;
}

function resizeShape(shape: Shape, from: Bounds, to: Bounds): Shape {
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  const mapX = (x: number) => to.x + (x - from.x) * scaleX;
  const mapY = (y: number) => to.y + (y - from.y) * scaleY;
  if (shape.type === "pen" || shape.type === "arrow") {
    return { ...shape, points: shape.points.map((value, index) => index % 2 === 0 ? mapX(value) : mapY(value)) };
  }
  if (shape.type === "rect") {
    const rect = normalizeRect(shape);
    return { ...shape, x: mapX(rect.x), y: mapY(rect.y), width: rect.width * scaleX, height: rect.height * scaleY };
  }
  return { ...shape, x: mapX(shape.x), y: mapY(shape.y), width: Math.max(24, to.width), autoResize: false };
}

function rotateShape(shape: Shape, angle: number): Shape {
  return { ...shape, angle };
}

function reorderShapes(shapes: Shape[], ids: string[], direction: "front" | "back") {
  const selected = new Set(ids);
  const picked = shapes.filter((shape) => selected.has(shape.id));
  if (picked.length === 0) return shapes;
  const rest = shapes.filter((shape) => !selected.has(shape.id));
  const next = direction === "front" ? [...rest, ...picked] : [...picked, ...rest];
  return next.every((shape, index) => shape.id === shapes[index]?.id) ? shapes : next;
}

function updateArrowPoint(shape: Extract<Shape, { type: "arrow" }>, pointIndex: number, point: { x: number; y: number }) {
  const points = [...shape.points];
  points[pointIndex * 2] = point.x;
  points[pointIndex * 2 + 1] = point.y;
  return { ...shape, points };
}

function textDraftToShape(draft: TextDraft): TextShape | null {
  const text = draft.text.trim();
  if (!text || !draft.id) return null;
  return {
    id: draft.id,
    type: "text",
    x: draft.x,
    y: draft.y,
    text,
    originalText: draft.originalText,
    width: draft.width,
    color: draft.color,
    strokeWidth: draft.strokeWidth,
    fontSize: draft.fontSize,
    fontFamily: draft.fontFamily,
    textAlign: draft.textAlign,
    lineHeight: draft.lineHeight,
    autoResize: draft.autoResize,
    verticalAlign: draft.verticalAlign,
    containerId: draft.containerId,
    angle: draft.angle
  };
}

export default function App() {
  const source = useImageSource();
  const [canvasImage, setCanvasImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 620 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<DrawColor>("#e11d48");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [fontFamily, setFontFamily] = useState<string | undefined>(undefined);
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">("left");
  const [history, setHistory] = useState(() => createHistory<Shape[]>([]));
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [transformPreview, setTransformPreview] = useState<TransformPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const stageRef = useRef<Konva.Stage>(null);
  const rafRef = useRef<number | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const previewRef = useRef<TransformPreview | null>(null);

  const shapes = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  useEffect(() => {
    if (!source) return;
    const scene = source.source.scene
      ? normalizeScene(source.source.scene, { canvasFallback: { width: source.width, height: source.height } })
      : null;
    setCanvasImage(source.image);
    setCanvasSize(scene?.canvas ?? { width: source.width, height: source.height });
    setHistory(createHistory<Shape[]>(scene?.shapes ?? []));
    setSelectedIds([]);
  }, [source]);

  const pointer = useCallback(() => {
    const stage = stageRef.current;
    return stage?.getPointerPosition() ?? { x: 0, y: 0 };
  }, []);

  const commit = useCallback((shape: Shape) => {
    setHistory((current) => {
      let finalShape: Shape = shape.type === "rect" ? normalizeRect(shape) : shape;
      if (finalShape.type === "arrow") {
        const points = finalShape.points;
        const startBinding = bindingFor([points[0], points[1]], current.present);
        const endBinding = bindingFor([points[points.length - 2], points[points.length - 1]], current.present);
        finalShape = { ...finalShape, ...(startBinding ? { startBinding } : {}), ...(endBinding ? { endBinding } : {}) };
      }
      return pushHistory(current, [...current.present, finalShape]);
    });
  }, []);

  const onPointerDown = useCallback((event: Konva.KonvaEventObject<PointerEvent>) => {
    if (tool === "select") {
      if (event.target === event.target.getStage() || event.target.name() === "canvas-background" || event.target.name() === "canvas-image") setSelectedIds([]);
      return;
    }

    const point = pointer();
    setSelectedIds([]);
    setIsDrawing(true);

    if (tool === "text") {
      setIsDrawing(false);
      setTextDraft({ id: shapeId(), x: point.x, y: point.y, text: "", color, strokeWidth, fontSize, fontFamily, textAlign, lineHeight: 1.24, autoResize: true });
      return;
    }

    if (tool === "pen" || tool === "highlighter") {
      setDraft({
        id: shapeId(),
        type: "pen",
        points: [point.x, point.y],
        color: tool === "highlighter" ? "#f59e0b" : color,
        strokeWidth,
        opacity: tool === "highlighter" ? 0.35 : undefined
      });
    } else if (tool === "arrow") {
      setDraft({ id: shapeId(), type: "arrow", points: [point.x, point.y, point.x, point.y], color, strokeWidth });
    } else {
      setDraft({
        id: shapeId(),
        type: "rect",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        color: tool === "redact" ? "#111827" : color,
        strokeWidth,
        fill: tool === "redact" ? "#111827" : undefined
      });
    }
  }, [color, fontFamily, fontSize, pointer, strokeWidth, textAlign, tool]);

  const onPointerMove = useCallback(() => {
    const currentDraft = draftRef.current ?? draft;
    if (!isDrawing || !currentDraft) return;
    const point = pointer();
    let nextDraft: Shape = currentDraft;
    if (currentDraft.type === "pen") {
      nextDraft = { ...currentDraft, points: [...currentDraft.points, point.x, point.y] };
    } else if (currentDraft.type === "arrow") {
      nextDraft = { ...currentDraft, points: [currentDraft.points[0], currentDraft.points[1], point.x, point.y] };
    } else if (currentDraft.type === "rect") {
      nextDraft = { ...currentDraft, width: point.x - currentDraft.x, height: point.y - currentDraft.y };
    }
    draftRef.current = nextDraft;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setDraft(draftRef.current);
    });
  }, [draft, isDrawing, pointer]);

  const onPointerUp = useCallback(() => {
    const finalDraft = draftRef.current ?? draft;
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (finalDraft) commit(finalDraft);
    draftRef.current = null;
    setDraft(null);
    setIsDrawing(false);
  }, [commit, draft]);

  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  // Coalesce high-frequency transform previews (move/resize/rotate/arrow-point) into one
  // paint per frame, mirroring the pen-draw rAF throttle above.
  const scheduleTransformPreview = useCallback((next: TransformPreview) => {
    previewRef.current = next;
    if (previewRafRef.current !== null) return;
    previewRafRef.current = window.requestAnimationFrame(() => {
      previewRafRef.current = null;
      setTransformPreview(previewRef.current);
    });
  }, []);

  const clearTransformPreview = useCallback(() => {
    if (previewRafRef.current !== null) window.cancelAnimationFrame(previewRafRef.current);
    previewRafRef.current = null;
    previewRef.current = null;
    setTransformPreview(null);
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    if (previewRafRef.current !== null) window.cancelAnimationFrame(previewRafRef.current);
  }, []);

  const updateFontSize = useCallback((next: number) => {
    setFontSize(next);
    setTextDraft((current) => current ? { ...current, fontSize: next } : current);
  }, []);

  const updateFontFamily = useCallback((next: string | undefined) => {
    setFontFamily(next);
    setTextDraft((current) => current ? { ...current, fontFamily: next } : current);
  }, []);

  const updateTextAlign = useCallback((next: "left" | "center" | "right") => {
    setTextAlign(next);
    setTextDraft((current) => current ? { ...current, textAlign: next } : current);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    setHistory((current) => pushHistory(current, current.present.filter((shape) => !selected.has(shape.id))));
    setSelectedIds([]);
  }, [selectedIds]);

  const sendSelectedToBack = useCallback(() => {
    if (selectedIds.length === 0) return;
    setHistory((current) => {
      const next = reorderShapes(current.present, selectedIds, "back");
      return next === current.present ? current : pushHistory(current, next);
    });
  }, [selectedIds]);

  const bringSelectedToFront = useCallback(() => {
    if (selectedIds.length === 0) return;
    setHistory((current) => {
      const next = reorderShapes(current.present, selectedIds, "front");
      return next === current.present ? current : pushHistory(current, next);
    });
  }, [selectedIds]);

  const commitText = useCallback((shape: TextShape) => {
    setHistory((current) => pushHistory(current, shape.id
      ? current.present.some((item) => item.id === shape.id)
        ? current.present.map((item) => item.id === shape.id ? shape : item)
        : [...current.present, shape]
      : [...current.present, { ...shape, id: crypto.randomUUID() }]));
    setTextDraft(null);
    setSelectedIds([shape.id]);
  }, []);

  const cancelText = useCallback(() => setTextDraft(null), []);

  const editText = useCallback((shape: TextShape) => {
    setTextDraft({
      id: shape.id,
      x: shape.x,
      y: shape.y,
      text: shape.originalText ?? shape.text,
      originalText: shape.originalText,
      width: shape.width,
      color: shape.color,
      strokeWidth: shape.strokeWidth,
      fontSize: shape.fontSize ?? fontSize,
      fontFamily: shape.fontFamily,
      textAlign: shape.textAlign ?? "left",
      lineHeight: shape.lineHeight ?? 1.24,
      autoResize: shape.autoResize ?? shape.width === undefined,
      verticalAlign: shape.verticalAlign,
      containerId: shape.containerId,
      angle: shape.angle
    });
    setSelectedIds([shape.id]);
    setTool("text");
  }, [fontSize]);

  const moveShapes = useCallback((ids: string[], dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const selected = new Set(ids);
    // Reflow arrows whose target moved; arrows in the moved set already translate with it.
    setHistory((current) => pushHistory(current, reflowBoundArrows(
      current.present.map((shape) => selected.has(shape.id) ? translateShape(shape, dx, dy) : shape),
      selected
    )));
  }, []);

  const resizeSelected = useCallback((handle: ResizeHandle, point: { x: number; y: number }, keepAspect: boolean) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const shape = shapes.find((item) => item.id === id);
    if (!shape) return;
    const from = shapeBounds(shape);
    const to = resizeBounds(from, handle, point, keepAspect);
    setHistory((current) => pushHistory(current, reflowBoundArrows(current.present.map((item) => item.id === id ? resizeShape(item, from, to) : item))));
    clearTransformPreview();
  }, [clearTransformPreview, selectedIds, shapes]);

  const previewResizeSelected = useCallback((handle: ResizeHandle, point: { x: number; y: number }, keepAspect: boolean) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const shape = shapes.find((item) => item.id === id);
    if (!shape) return;
    const from = shapeBounds(shape);
    scheduleTransformPreview({ kind: "resize", id, from, to: resizeBounds(from, handle, point, keepAspect) });
  }, [scheduleTransformPreview, selectedIds, shapes]);

  const rotateSelected = useCallback((point: { x: number; y: number }) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const shape = shapes.find((item) => item.id === id);
    if (!shape || shape.type === "pen" || shape.type === "arrow") return;
    const bounds = shapeBounds(shape);
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const angle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90;
    setHistory((current) => pushHistory(current, current.present.map((item) => item.id === id ? rotateShape(item, angle) : item)));
    clearTransformPreview();
  }, [clearTransformPreview, selectedIds, shapes]);

  const previewRotateSelected = useCallback((point: { x: number; y: number }) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const shape = shapes.find((item) => item.id === id);
    if (!shape || shape.type === "pen" || shape.type === "arrow") return;
    const bounds = shapeBounds(shape);
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    scheduleTransformPreview({ kind: "rotate", id, angle: Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90 });
  }, [scheduleTransformPreview, selectedIds, shapes]);

  const updateSelectedArrowPoint = useCallback((pointIndex: number, point: { x: number; y: number }) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    setHistory((current) => pushHistory(current, current.present.map((shape) => {
      if (shape.id !== id || shape.type !== "arrow") return shape;
      const updated = updateArrowPoint(shape, pointIndex, point);
      // Only the true endpoints carry bindings; a middle control point leaves both intact.
      const isStart = pointIndex === 0;
      const isEnd = pointIndex === shape.points.length / 2 - 1;
      if (!isStart && !isEnd) return updated;
      // Dropping an endpoint on a shape (re)binds it; dropping in empty space clears it.
      const binding = bindingFor([point.x, point.y], current.present.filter((item) => item.id !== id));
      return { ...updated, startBinding: isStart ? binding : updated.startBinding, endBinding: isEnd ? binding : updated.endBinding };
    })));
    clearTransformPreview();
  }, [clearTransformPreview, selectedIds]);

  const previewSelectedArrowPoint = useCallback((pointIndex: number, point: { x: number; y: number }) => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const shape = shapes.find((item) => item.id === id);
    if (!shape || shape.type !== "arrow") return;
    scheduleTransformPreview({ kind: "arrow-points", id, points: updateArrowPoint(shape, pointIndex, point).points });
  }, [scheduleTransformPreview, selectedIds, shapes]);

  const done = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setSaveState("saving");
    const textShape = textDraft ? textDraftToShape(textDraft) : null;
    const saveShapes = textDraft
      ? textShape
        ? shapes.some((item) => item.id === textShape.id)
          ? shapes.map((item) => item.id === textShape.id ? textShape : item)
          : [...shapes, textShape]
        : shapes.filter((shape) => shape.id !== textDraft.id)
      : shapes;
    if (textDraft) {
      setHistory((current) => pushHistory(current, saveShapes));
      setTextDraft(null);
    }
    const selectionOutlines = stage.find(".selection-outline");
    selectionOutlines.forEach((node) => node.hide());
    try {
      const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
      const response = await fetch("/api/done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, width: canvasSize.width, height: canvasSize.height, scene: sceneFromShapes({ ...canvasSize, background: "#ffffff" }, saveShapes) })
      });
      if (!response.ok) throw new Error("save failed");
      window.close();
    } catch {
      setSaveState("error");
    } finally {
      selectionOutlines.forEach((node) => node.show());
    }
  }, [canvasSize, shapes, textDraft]);

  const cancel = useCallback(async () => {
    await fetch("/api/cancel", { method: "POST" });
    window.close();
  }, []);

  const loadPastedImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        setCanvasImage(image);
        setCanvasSize({ width: image.naturalWidth, height: image.naturalHeight });
        setHistory(createHistory<Shape[]>([]));
        setDraft(null);
        setSelectedIds([]);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (!isTyping && !event.metaKey && !event.ctrlKey && !event.altKey && toolShortcuts[event.key]) {
        event.preventDefault();
        setTool(toolShortcuts[event.key]);
        setSelectedIds([]);
      } else if (!isTyping && (event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        deleteSelected();
      } else if (!isTyping && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedIds.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        moveShapes(selectedIds, dx, dy);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void done();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        return;
      } else if (!isTyping && event.key === "Enter") {
        event.preventDefault();
        void done();
      } else if (!isTyping && event.key === "Escape") {
        event.preventDefault();
        if (selectedIds.length > 0) setSelectedIds([]);
        else void cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, deleteSelected, done, moveShapes, redo, selectedIds, undo]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      loadPastedImage(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadPastedImage]);

  const rendered = useMemo(() => {
    let nextShapes = shapes;
    const textShape = textDraft ? textDraftToShape(textDraft) : null;
    if (textDraft) {
      nextShapes = textShape
        ? shapes.some((shape) => shape.id === textShape.id)
          ? shapes.map((shape) => shape.id === textShape.id ? textShape : shape)
          : [...shapes, textShape]
        : shapes.filter((shape) => shape.id !== textDraft.id);
    }
    if (draft) nextShapes = [...nextShapes, draft];
    if (!transformPreview) return nextShapes;
    return nextShapes.map((shape) => {
      if (transformPreview.kind === "move") {
        return transformPreview.ids.includes(shape.id) ? translateShape(shape, transformPreview.dx, transformPreview.dy) : shape;
      }
      if (transformPreview.kind === "resize") {
        return shape.id === transformPreview.id ? resizeShape(shape, transformPreview.from, transformPreview.to) : shape;
      }
      if (transformPreview.kind === "arrow-points") {
        return shape.id === transformPreview.id && shape.type === "arrow" ? { ...shape, points: transformPreview.points } : shape;
      }
      return shape.id === transformPreview.id ? rotateShape(shape, transformPreview.angle) : shape;
    });
  }, [draft, shapes, textDraft, transformPreview]);
  const selectedShape = selectedIds.length === 1 ? rendered.find((shape) => shape.id === selectedIds[0]) : undefined;

  if (!source) return <div className="loading">Loading quick-paint...</div>;

  return (
    <main className="shell">
      <div className="toolbar" role="toolbar" aria-label="quick-paint tools">
        <ToolButton active={tool === "select"} title="Select (1)" onClick={() => setTool("select")}><MousePointer2 size={17} /></ToolButton>
        <ToolButton active={tool === "pen"} title="Pen (2)" onClick={() => setTool("pen")}><PenLine size={17} /></ToolButton>
        <ToolButton active={tool === "highlighter"} title="Highlighter (3)" onClick={() => setTool("highlighter")}><Highlighter size={17} /></ToolButton>
        <ToolButton active={tool === "arrow"} title="Arrow (4)" onClick={() => setTool("arrow")}><ArrowRight size={17} /></ToolButton>
        <ToolButton active={tool === "rect"} title="Rectangle (5)" onClick={() => setTool("rect")}><Square size={17} /></ToolButton>
        <ToolButton active={tool === "text"} title="Text (6)" onClick={() => setTool("text")}><Type size={17} /></ToolButton>
        <ToolButton active={tool === "redact"} title="Redact (7)" onClick={() => setTool("redact")}><ScanLine size={17} /></ToolButton>
        <span className="divider" />
        <ToolButton disabled={!canUndo} title="Undo" onClick={undo}><Undo2 size={17} /></ToolButton>
        <ToolButton disabled={!canRedo} title="Redo" onClick={redo}><Redo2 size={17} /></ToolButton>
        <ToolButton disabled={selectedIds.length === 0} title="Delete selected" onClick={deleteSelected}><Trash2 size={17} /></ToolButton>
        <ToolButton disabled={selectedIds.length === 0} title="Send to back" onClick={sendSelectedToBack}><SendToBack size={17} /></ToolButton>
        <ToolButton disabled={selectedIds.length === 0} title="Bring to front" onClick={bringSelectedToFront}><BringToFront size={17} /></ToolButton>
        <span className="divider" />
        <div className="swatches">
          {colors.map((swatch) => (
            <button
              aria-label={`Color ${swatch}`}
              className={swatch === color ? "swatch active" : "swatch"}
              key={swatch}
              onClick={() => setColor(swatch)}
              style={{ background: swatch }}
              title={swatch}
            />
          ))}
        </div>
        <select aria-label="Stroke width" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>
          {widths.map((width) => <option key={width} value={width}>{width}px</option>)}
        </select>
        <select aria-label="Font size" value={textDraft?.fontSize ?? fontSize} onChange={(event) => updateFontSize(Number(event.target.value))}>
          {fontSizes.map((size) => <option key={size} value={size}>{size}px</option>)}
        </select>
        <select aria-label="Font family" value={textDraft?.fontFamily ?? fontFamily ?? ""} onChange={(event) => updateFontFamily(event.target.value || undefined)}>
          {fontFamilies.map((font) => <option key={font.label} value={font.value ?? ""}>{font.label}</option>)}
        </select>
        <SegmentButton active={(textDraft?.textAlign ?? textAlign) === "left"} title="Align left" onMouseDown={(event) => event.preventDefault()} onClick={() => updateTextAlign("left")}><AlignLeft size={16} /></SegmentButton>
        <SegmentButton active={(textDraft?.textAlign ?? textAlign) === "center"} title="Align center" onMouseDown={(event) => event.preventDefault()} onClick={() => updateTextAlign("center")}><AlignCenter size={16} /></SegmentButton>
        <SegmentButton active={(textDraft?.textAlign ?? textAlign) === "right"} title="Align right" onMouseDown={(event) => event.preventDefault()} onClick={() => updateTextAlign("right")}><AlignRight size={16} /></SegmentButton>
        <span className="spacer" />
        <span className="meta"><MousePointer2 size={14} /> {canvasSize.width}x{canvasSize.height}</span>
        <button className="action subtle" onClick={cancel}><X size={16} />Cancel</button>
        {saveState === "error" && <span className="saveError">Save failed</span>}
        <button className="action done" disabled={saveState === "saving"} onClick={done}>
          <Check size={16} />{saveState === "saving" ? "Saving" : "Save"}
        </button>
      </div>

      <section className="canvasRail">
        <div className="canvasFrame" style={{ width: canvasSize.width, height: canvasSize.height }}>
          <Stage
            ref={stageRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="stage"
          >
          <Layer>
            <Rect width={canvasSize.width} height={canvasSize.height} fill="#ffffff" name="canvas-background" />
            {canvasImage && <KonvaImage image={canvasImage} width={canvasSize.width} height={canvasSize.height} name="canvas-image" />}
          </Layer>
          <Layer listening={false}>
            {rendered.map((shape) => (
              <ShapeNode key={shape.id} shape={shape} />
            ))}
          </Layer>
          <Layer>
            {rendered.map((shape) => {
              const isSelected = selectedIds.includes(shape.id);
              const hideInlineBounds = selectedShape?.id === shape.id && Boolean(shape.angle) && (shape.type === "rect" || shape.type === "text");
              const bounds = isSelected && !hideInlineBounds ? selectionBounds(shape) : null;
              return (
                <Group
                  key={shape.id}
                  draggable={tool === "select" && isSelected}
                  onClick={(event) => {
                    if (tool !== "select") return;
                    event.cancelBubble = true;
                  }}
                  onPointerDown={(event) => {
                    if (tool !== "select") return;
                    event.cancelBubble = true;
                    setSelectedIds((current) => event.evt.shiftKey
                      ? current.includes(shape.id) ? current.filter((id) => id !== shape.id) : [...current, shape.id]
                      : current.includes(shape.id) ? current : [shape.id]);
                  }}
                  onDblClick={(event) => {
                    if (shape.type !== "text") return;
                    event.cancelBubble = true;
                    editText(shape);
                  }}
                  onDblTap={(event) => {
                    if (shape.type !== "text") return;
                    event.cancelBubble = true;
                    editText(shape);
                  }}
                  onDragEnd={(event) => {
                    const { x, y } = event.target.position();
                    event.target.position({ x: 0, y: 0 });
                    clearTransformPreview();
                    moveShapes(selectedIds.includes(shape.id) ? selectedIds : [shape.id], x, y);
                  }}
                  onDragMove={(event) => {
                    const { x, y } = event.target.position();
                    scheduleTransformPreview({ kind: "move", ids: selectedIds.includes(shape.id) ? selectedIds : [shape.id], dx: x, dy: y });
                  }}
                  onMouseDown={(event) => {
                    if (tool !== "select") return;
                    event.cancelBubble = true;
                  }}
                  onTap={(event) => {
                    if (tool !== "select") return;
                    event.cancelBubble = true;
                    setSelectedIds([shape.id]);
                  }}
                  onTouchStart={(event) => {
                    if (tool !== "select") return;
                    event.cancelBubble = true;
                    setSelectedIds([shape.id]);
                  }}
                >
                  <ShapeHitTarget shape={shape} />
                  {bounds && <Rect {...bounds} name="selection-outline" listening={false} fill="transparent" stroke="#2563eb" strokeWidth={1.5} dash={[6, 4]} />}
                </Group>
              );
            })}
            {selectedShape && tool === "select" && <ResizeHandles angle={selectedShape.angle ?? 0} bounds={shapeBounds(selectedShape)} canResize={!selectedShape.angle && selectedShape.type !== "arrow"} canRotate={selectedShape.type === "rect" || selectedShape.type === "text"} onResize={resizeSelected} onResizePreview={previewResizeSelected} onRotate={rotateSelected} onRotatePreview={previewRotateSelected} />}
            {selectedShape?.type === "arrow" && tool === "select" && <ArrowPointHandles shape={selectedShape} onMove={updateSelectedArrowPoint} onMovePreview={previewSelectedArrowPoint} />}
            </Layer>
          </Stage>
          {textDraft && <TextEditor draft={textDraft} metrics={textMetrics({ ...textDraft, id: textDraft.id ?? "draft", type: "text" })} onChange={setTextDraft} onCommit={commitText} onCancel={cancelText} />}
        </div>
      </section>
    </main>
  );
}

function ToolButton(props: { active?: boolean; disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={props.active ? "tool active" : "tool"} disabled={props.disabled} onClick={props.onClick} title={props.title} aria-label={props.title}>
      {props.children}
    </button>
  );
}

function SegmentButton(props: { active?: boolean; title: string; onMouseDown?: React.MouseEventHandler<HTMLButtonElement>; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={props.active ? "segment active" : "segment"} onMouseDown={props.onMouseDown} onClick={props.onClick} title={props.title} aria-label={props.title}>
      {props.children}
    </button>
  );
}

function ShapeHitTarget(props: { shape: Shape }) {
  const { shape } = props;
  if (shape.type === "pen") {
    return <Line id={shape.id} name="shape-hit" points={shape.points} stroke="#000000" opacity={0} strokeWidth={Math.max(shape.strokeWidth, 18)} tension={0.45} lineCap="round" lineJoin="round" />;
  }
  if (shape.type === "arrow") {
    return <Line id={shape.id} name="shape-hit" points={shape.points} stroke="#000000" opacity={0} strokeWidth={Math.max(shape.strokeWidth, 18)} lineCap="round" />;
  }
  if (shape.type === "rect") {
    const rect = normalizeRect(shape);
    if (rect.angle) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      return <Group x={cx} y={cy} rotation={rect.angle}><Rect id={shape.id} name="shape-hit" x={-rect.width / 2} y={-rect.height / 2} width={rect.width} height={rect.height} fill="#000000" opacity={0} strokeEnabled={false} /></Group>;
    }
    return <Rect id={shape.id} name="shape-hit" x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="#000000" opacity={0} strokeEnabled={false} />;
  }
  const bounds = shapeBounds(shape);
  return <Group x={shape.x} y={shape.y} rotation={shape.angle ?? 0}><Rect id={shape.id} name="shape-hit" x={bounds.x - shape.x} y={bounds.y - shape.y} width={bounds.width} height={bounds.height} fill="#000000" opacity={0} strokeEnabled={false} /></Group>;
}

function ArrowPointHandles(props: {
  shape: Extract<Shape, { type: "arrow" }>;
  onMove: (pointIndex: number, point: { x: number; y: number }) => void;
  onMovePreview: (pointIndex: number, point: { x: number; y: number }) => void;
}) {
  const points = props.shape.points.reduce<Array<{ x: number; y: number }>>((items, value, index) => {
    if (index % 2 === 0) items.push({ x: value, y: props.shape.points[index + 1] });
    return items;
  }, []);
  return (
    <>
      {points.map((point, index) => (
        <Rect
          draggable
          fill="#ffffff"
          height={handleSize + 2}
          key={index}
          name="selection-outline arrow-point-handle"
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onPointerDown={(event) => {
            event.cancelBubble = true;
          }}
          onDragMove={(event) => {
            props.onMovePreview(index, { x: event.target.x() + (handleSize + 2) / 2, y: event.target.y() + (handleSize + 2) / 2 });
          }}
          onDragEnd={(event) => {
            const x = event.target.x() + (handleSize + 2) / 2;
            const y = event.target.y() + (handleSize + 2) / 2;
            event.target.position({ x: point.x - (handleSize + 2) / 2, y: point.y - (handleSize + 2) / 2 });
            props.onMove(index, { x, y });
          }}
          stroke="#2563eb"
          strokeWidth={1.8}
          width={handleSize + 2}
          x={point.x - (handleSize + 2) / 2}
          y={point.y - (handleSize + 2) / 2}
        />
      ))}
    </>
  );
}

const ShapeNode = memo(function ShapeNode(props: { shape: Shape }) {
  const { shape } = props;
  if (shape.type === "pen") {
    return <Line points={shape.points} stroke={shape.color} strokeWidth={shape.opacity ? Math.max(shape.strokeWidth, 18) : shape.strokeWidth} opacity={shape.opacity ?? 1} tension={0.45} lineCap="round" lineJoin="round" perfectDrawEnabled={false} />;
  }
  if (shape.type === "arrow") {
    return <>
      <Arrow points={shape.points} stroke={shape.color} fill={shape.color} strokeWidth={shape.strokeWidth} pointerLength={16} pointerWidth={14} lineCap="round" perfectDrawEnabled={false} />
      {shape.label && <KonvaText x={(shape.points[0] + shape.points[2]) / 2} y={(shape.points[1] + shape.points[3]) / 2 - 22} text={shape.label} fill={shape.color} fontSize={16} fontStyle="600" align="center" />}
    </>;
  }
  if (shape.type === "rect") {
    const rect = normalizeRect(shape);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return <Group x={cx} y={cy} rotation={rect.angle ?? 0}>
      <Rect x={-rect.width / 2} y={-rect.height / 2} width={rect.width} height={rect.height} fill={rect.fill ?? "transparent"} stroke={rect.color} strokeWidth={rect.strokeWidth} perfectDrawEnabled={false} />
      {rect.label && <KonvaText x={-rect.width / 2} y={-12} width={rect.width} text={rect.label} fill={rect.fill ? "#ffffff" : rect.color} fontSize={18} fontStyle="600" align="center" />}
    </Group>;
  }
  const text = textMetrics(shape);
  return <Group x={shape.x} y={shape.y} rotation={shape.angle ?? 0}>
    <KonvaText x={text.x - shape.x} y={0} width={text.width} text={text.lines.join("\n")} fill={shape.color} fontSize={text.fontSize} fontFamily={text.fontFamily} fontStyle="600" align={text.align} wrap="none" lineHeight={text.lineHeight} perfectDrawEnabled={false} />
  </Group>;
});

function ResizeHandles(props: {
  angle: number;
  bounds: Bounds;
  canResize: boolean;
  canRotate: boolean;
  onResize: (handle: ResizeHandle, point: { x: number; y: number }, keepAspect: boolean) => void;
  onResizePreview: (handle: ResizeHandle, point: { x: number; y: number }, keepAspect: boolean) => void;
  onRotate: (point: { x: number; y: number }) => void;
  onRotatePreview: (point: { x: number; y: number }) => void;
}) {
  const rotatePoint = { x: props.bounds.x + props.bounds.width / 2, y: props.bounds.y - rotateHandleOffset };
  const center = { x: props.bounds.x + props.bounds.width / 2, y: props.bounds.y + props.bounds.height / 2 };
  return (
    <>
      <Group x={center.x} y={center.y} rotation={props.angle} name="selection-outline">
        <Rect x={-props.bounds.width / 2} y={-props.bounds.height / 2} width={props.bounds.width} height={props.bounds.height} listening={false} fill="transparent" stroke="#2563eb" strokeWidth={1.5} dash={[6, 4]} />
      </Group>
      {props.canResize && resizeHandles.map((handle) => {
        const point = handlePoint(props.bounds, handle);
        return (
          <Rect
            aria-label={`Resize ${handle}`}
            draggable
            fill="#ffffff"
            height={handleSize}
            key={handle}
            name="selection-outline resize-handle"
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onPointerDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragEnd={(event) => {
              const x = event.target.x() + handleSize / 2;
              const y = event.target.y() + handleSize / 2;
              event.target.position({ x: point.x - handleSize / 2, y: point.y - handleSize / 2 });
              props.onResize(handle, { x, y }, event.evt.shiftKey);
            }}
            onDragMove={(event) => {
              props.onResizePreview(handle, { x: event.target.x() + handleSize / 2, y: event.target.y() + handleSize / 2 }, event.evt.shiftKey);
            }}
            stroke="#2563eb"
            strokeWidth={1.5}
            width={handleSize}
            x={point.x - handleSize / 2}
            y={point.y - handleSize / 2}
          />
        );
      })}
      {props.canRotate && <>
        <Line points={[props.bounds.x + props.bounds.width / 2, props.bounds.y, rotatePoint.x, rotatePoint.y]} stroke="#2563eb" strokeWidth={1} dash={[4, 4]} listening={false} name="selection-outline" />
        <Rect
          draggable
          fill="#ffffff"
          height={handleSize}
          name="selection-outline"
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onPointerDown={(event) => {
            event.cancelBubble = true;
          }}
          onDragEnd={(event) => {
            const x = event.target.x() + handleSize / 2;
            const y = event.target.y() + handleSize / 2;
            event.target.position({ x: rotatePoint.x - handleSize / 2, y: rotatePoint.y - handleSize / 2 });
            props.onRotate({ x, y });
          }}
          onDragMove={(event) => {
            props.onRotatePreview({ x: event.target.x() + handleSize / 2, y: event.target.y() + handleSize / 2 });
          }}
          stroke="#2563eb"
          strokeWidth={1.5}
          width={handleSize}
          x={rotatePoint.x - handleSize / 2}
          y={rotatePoint.y - handleSize / 2}
        />
      </>}
    </>
  );
}
