import { useEffect, useRef } from "react";
import type { DrawColor, TextShape } from "../tools/types";

export type TextDraft = {
  id?: string;
  x: number;
  y: number;
  text: string;
  originalText?: string;
  width?: number;
  color: DrawColor;
  strokeWidth: number;
  fontSize: number;
  fontFamily?: string;
  textAlign: "left" | "center" | "right";
  lineHeight?: number;
  autoResize?: boolean;
  verticalAlign?: "top" | "middle" | "bottom";
  containerId?: string;
  angle?: number;
};

type TextEditorProps = {
  draft: TextDraft;
  metrics: { x: number; width: number; lineHeight: number };
  onChange: (draft: TextDraft) => void;
  onCommit: (shape: TextShape) => void;
  onCancel: () => void;
};

export function TextEditor({ draft, metrics, onChange, onCommit, onCancel }: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const focusId = window.setTimeout(() => {
      textarea.focus();
      textarea.select();
      resize(textarea);
    }, 0);
    return () => window.clearTimeout(focusId);
  }, []);

  const commit = () => {
    const text = draft.text.trim();
    if (!text) {
      onCancel();
      return;
    }
    onCommit({
      id: draft.id ?? crypto.randomUUID(),
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
    });
  };

  return (
    <textarea
      aria-label="Text"
      className="textEditor"
      value={draft.text}
      onBlur={(event) => {
        if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest(".toolbar")) return;
        commit();
      }}
      onInput={(event) => {
        onChange({ ...draft, text: event.currentTarget.value, originalText: event.currentTarget.value });
        resize(event.currentTarget);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
      }}
      ref={ref}
      style={{
        left: metrics.x,
        top: draft.y,
        width: metrics.width,
        color: draft.color,
        fontSize: draft.fontSize,
        fontFamily: draft.fontFamily,
        textAlign: draft.textAlign,
        lineHeight: metrics.lineHeight,
        transform: `rotate(${draft.angle ?? 0}deg)`,
        transformOrigin: `${draft.x - metrics.x}px 0`
      }}
    />
  );
}

function resize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "1px";
  textarea.style.height = `${Math.max(40, textarea.scrollHeight + 4)}px`;
}
