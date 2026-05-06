import { ArrowRight, Check, Highlighter, MousePointer2, PenLine, Redo2, ScanLine, Square, Type, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Arrow, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText } from "react-konva";
import type Konva from "konva";
import { createHistory, pushHistory, redoHistory, undoHistory } from "./canvas/history";
import { useImageSource } from "./canvas/useImageSource";
import type { DrawColor, Shape, Tool } from "./tools/types";

const colors: DrawColor[] = ["#e11d48", "#f59e0b", "#10b981", "#2563eb", "#111827", "#ffffff"];
const widths = [2, 4, 8, 14];

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

export default function App() {
  const source = useImageSource();
  const [canvasImage, setCanvasImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 620 });
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<DrawColor>("#e11d48");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [history, setHistory] = useState(() => createHistory<Shape[]>([]));
  const [draft, setDraft] = useState<Shape | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const stageRef = useRef<Konva.Stage>(null);

  const shapes = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  useEffect(() => {
    if (!source) return;
    setCanvasImage(source.image);
    setCanvasSize({ width: source.width, height: source.height });
  }, [source]);

  const pointer = useCallback(() => {
    const stage = stageRef.current;
    return stage?.getPointerPosition() ?? { x: 0, y: 0 };
  }, []);

  const commit = useCallback((shape: Shape) => {
    const finalShape = shape.type === "rect" ? normalizeRect(shape) : shape;
    setHistory((current) => pushHistory(current, [...current.present, finalShape]));
  }, []);

  const onPointerDown = useCallback(() => {
    const point = pointer();
    setIsDrawing(true);

    if (tool === "text") {
      const text = window.prompt("Text");
      setIsDrawing(false);
      if (text?.trim()) {
        commit({ id: shapeId(), type: "text", x: point.x, y: point.y, text: text.trim(), color, strokeWidth });
      }
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
  }, [color, commit, pointer, strokeWidth, tool]);

  const onPointerMove = useCallback(() => {
    if (!isDrawing || !draft) return;
    const point = pointer();
    if (draft.type === "pen") {
      setDraft({ ...draft, points: [...draft.points, point.x, point.y] });
    } else if (draft.type === "arrow") {
      setDraft({ ...draft, points: [draft.points[0], draft.points[1], point.x, point.y] });
    } else if (draft.type === "rect") {
      setDraft({ ...draft, width: point.x - draft.x, height: point.y - draft.y });
    }
  }, [draft, isDrawing, pointer]);

  const onPointerUp = useCallback(() => {
    if (draft) commit(draft);
    setDraft(null);
    setIsDrawing(false);
  }, [commit, draft]);

  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  const done = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setSaveState("saving");
    try {
      const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
      const response = await fetch("/api/done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, width: canvasSize.width, height: canvasSize.height })
      });
      if (!response.ok) throw new Error("save failed");
      window.close();
    } catch {
      setSaveState("error");
    }
  }, [canvasSize.height, canvasSize.width]);

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
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void done();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        return;
      } else if (event.key === "Enter") {
        event.preventDefault();
        void done();
      } else if (event.key === "Escape") {
        event.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, done, redo, undo]);

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

  if (!source) return <div className="loading">Loading cldraw...</div>;

  const rendered = draft ? [...shapes, draft] : shapes;

  return (
    <main className="shell">
      <div className="toolbar" role="toolbar" aria-label="cldraw tools">
        <ToolButton active={tool === "pen"} title="Pen" onClick={() => setTool("pen")}><PenLine size={17} /></ToolButton>
        <ToolButton active={tool === "highlighter"} title="Highlighter" onClick={() => setTool("highlighter")}><Highlighter size={17} /></ToolButton>
        <ToolButton active={tool === "arrow"} title="Arrow" onClick={() => setTool("arrow")}><ArrowRight size={17} /></ToolButton>
        <ToolButton active={tool === "rect"} title="Rectangle" onClick={() => setTool("rect")}><Square size={17} /></ToolButton>
        <ToolButton active={tool === "text"} title="Text" onClick={() => setTool("text")}><Type size={17} /></ToolButton>
        <ToolButton active={tool === "redact"} title="Redact" onClick={() => setTool("redact")}><ScanLine size={17} /></ToolButton>
        <span className="divider" />
        <ToolButton disabled={!canUndo} title="Undo" onClick={undo}><Undo2 size={17} /></ToolButton>
        <ToolButton disabled={!canRedo} title="Redo" onClick={redo}><Redo2 size={17} /></ToolButton>
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
        <span className="spacer" />
        <span className="meta"><MousePointer2 size={14} /> {canvasSize.width}x{canvasSize.height}</span>
        <button className="action subtle" onClick={cancel}><X size={16} />Cancel</button>
        {saveState === "error" && <span className="saveError">Save failed</span>}
        <button className="action done" disabled={saveState === "saving"} onClick={done}>
          <Check size={16} />{saveState === "saving" ? "Saving" : "Save"}
        </button>
      </div>

      <section className="canvasRail">
        <Stage
          ref={stageRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
          className="stage"
        >
          <Layer>
            <Rect width={canvasSize.width} height={canvasSize.height} fill="#ffffff" />
            {canvasImage && <KonvaImage image={canvasImage} width={canvasSize.width} height={canvasSize.height} />}
            {rendered.map((shape) => {
              if (shape.type === "pen") {
                return <Line key={shape.id} points={shape.points} stroke={shape.color} strokeWidth={shape.opacity ? Math.max(shape.strokeWidth, 18) : shape.strokeWidth} opacity={shape.opacity ?? 1} tension={0.45} lineCap="round" lineJoin="round" />;
              }
              if (shape.type === "arrow") {
                return <Arrow key={shape.id} points={shape.points} stroke={shape.color} fill={shape.color} strokeWidth={shape.strokeWidth} pointerLength={16} pointerWidth={14} lineCap="round" />;
              }
              if (shape.type === "rect") {
                const rect = normalizeRect(shape);
                return <Rect key={shape.id} {...rect} fill={shape.fill ?? "transparent"} stroke={shape.color} strokeWidth={shape.strokeWidth} />;
              }
              return <KonvaText key={shape.id} x={shape.x} y={shape.y} text={shape.text} fill={shape.color} fontSize={28} fontStyle="600" />;
            })}
          </Layer>
        </Stage>
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
