import type { TextShape } from "./spec";

export type TextLayout = {
  align: "left" | "center" | "right";
  fontFamily: string;
  fontSize: number;
  height: number;
  lineHeight: number;
  lines: string[];
  width: number;
  x: number;
};

export function layoutText(shape: TextShape): TextLayout {
  const fontSize = shape.fontSize ?? 28;
  const fontFamily = shape.fontFamily ?? "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const lineHeight = Math.max(1, shape.lineHeight ?? 1.24);
  const source = shape.originalText ?? shape.text;
  const fixedWidth = shape.width && shape.width > 0 ? shape.width : null;
  const lines = fixedWidth ? wrapText(source, fixedWidth, fontSize, fontFamily) : source.split("\n");
  const measuredWidth = Math.max(28, ...lines.map((line) => measureTextLine(line, fontSize, fontFamily))) + 8;
  const width = fixedWidth ?? measuredWidth;
  const align = shape.textAlign ?? "left";
  return {
    align,
    fontFamily,
    fontSize,
    height: Math.max(fontSize * lineHeight, lines.length * fontSize * lineHeight),
    lineHeight,
    lines,
    width,
    x: align === "center" ? shape.x - width / 2 : align === "right" ? shape.x - width : shape.x
  };
}

export function wrapText(text: string, width: number, fontSize: number, fontFamily: string): string[] {
  const maxWidth = Math.max(12, width - 8);
  return text.split("\n").flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, fontSize, fontFamily));
}

function wrapParagraph(paragraph: string, width: number, fontSize: number, fontFamily: string): string[] {
  if (!paragraph) return [""];
  const tokens = paragraph.match(/\S+\s*/g) ?? [paragraph];
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current + token;
    if (measureTextLine(candidate.trimEnd(), fontSize, fontFamily) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current.trimEnd());
    current = token;
    while (measureTextLine(current.trimEnd(), fontSize, fontFamily) > width && current.trimEnd().length > 1) {
      const splitAt = splitToken(current.trimEnd(), width, fontSize, fontFamily);
      lines.push(current.slice(0, splitAt));
      current = current.slice(splitAt);
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines.length ? lines : [""];
}

function splitToken(token: string, width: number, fontSize: number, fontFamily: string) {
  let fit = 1;
  for (let index = 1; index <= token.length; index += 1) {
    if (measureTextLine(token.slice(0, index), fontSize, fontFamily) <= width) fit = index;
    else break;
  }
  return fit;
}

export function measureTextLine(text: string, fontSize: number, fontFamily = "") {
  const mono = /mono|menlo|consolas|courier/i.test(fontFamily);
  if (mono) return Array.from(text).length * fontSize * 0.61;
  return Array.from(text).reduce((width, char) => {
    if (/\s/.test(char)) return width + fontSize * 0.32;
    if (/[il.,'|]/.test(char)) return width + fontSize * 0.28;
    if (/[MW@#]/.test(char)) return width + fontSize * 1.02;
    if (/[A-Z0-9]/.test(char)) return width + fontSize * 0.66;
    return width + fontSize * 0.58;
  }, 0);
}
