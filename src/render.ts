import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { embedSceneMetadata } from "./png-metadata";
import { normalizeScene, resolveArrowPoints, type NormalizedScene, type Shape } from "./spec";
import { copyImageToClipboard } from "./clipboard";
import { layoutText } from "./text-layout";
import type { QuickPaintResult } from "./server";

export type RenderOptions = {
  outPath: string;
  clipboard?: boolean;
};

export function renderSceneToPng(input: unknown, options: RenderOptions): QuickPaintResult {
  const scene = normalizeScene(input);
  const tmp = mkdtempSync(join(tmpdir(), "quick-paint-render-"));
  const svgPath = join(tmp, "scene.svg");
  try {
    writeFileSync(svgPath, sceneToSvg(scene));
    mkdirSync(dirname(options.outPath), { recursive: true });
    renderSvgToPng(svgPath, options.outPath);
    writeFileSync(options.outPath, embedSceneMetadata(readFileSync(options.outPath), scene));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  let clipboard = false;
  if (options.clipboard) {
    try {
      clipboard = copyImageToClipboard(options.outPath);
    } catch {
      clipboard = false;
    }
  }
  return {
    path: options.outPath,
    mime: "image/png",
    width: scene.canvas.width,
    height: scene.canvas.height,
    clipboard
  };
}

export function renderSvgToPng(svgPath: string, outPath: string) {
  const renderers = [
    ["rsvg-convert", "-f", "png", "-o", outPath, svgPath],
    ["sips", "-s", "format", "png", svgPath, "--out", outPath],
    ["magick", svgPath, outPath]
  ];
  const errors: string[] = [];
  for (const command of renderers) {
    const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
    if (result.success) return;
    errors.push(`${command[0]}: ${result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.exitCode}`}`);
  }
  throw new Error(`failed to render SVG to PNG\n${errors.join("\n")}`);
}

function sceneToSvg(scene: NormalizedScene): string {
  const { width, height, background } = scene.canvas;
  const byId = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><marker id="arrowhead" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="${escapeAttr(background ?? "#ffffff")}"/>`,
    ...scene.shapes.map((shape) => shapeToSvg(shape.type === "arrow" ? { ...shape, points: resolveArrowPoints(shape, byId) } : shape)),
    `</svg>`
  ].join("");
}

function shapeToSvg(shape: Shape): string {
  if (shape.type === "rect") {
    const x = Math.min(shape.x, shape.x + shape.width);
    const y = Math.min(shape.y, shape.y + shape.height);
    const width = Math.abs(shape.width);
    const height = Math.abs(shape.height);
    const cx = x + width / 2;
    const cy = y + height / 2;
    const label = shape.label
      ? `<text x="${x + width / 2}" y="${y + height / 2 + 6}" fill="${shape.fill ? "#ffffff" : shape.color}" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="18" font-weight="650" text-anchor="middle">${escapeText(shape.label)}</text>`
      : "";
    return `<g transform="rotate(${shape.angle ?? 0} ${cx} ${cy})"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeAttr(shape.fill ?? "none")}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"/>${label}</g>`;
  }
  if (shape.type === "arrow") {
    const [x1, y1, x2, y2] = shape.points;
    const label = shape.label
      ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" fill="${shape.color}" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="16" font-weight="650" text-anchor="middle">${escapeText(shape.label)}</text>`
      : "";
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" stroke-linecap="round" marker-end="url(#arrowhead)"/>${label}`;
  }
  if (shape.type === "pen") {
    const points = shape.points.reduce<string[]>((parts, value, index) => {
      if (index % 2 === 0) parts.push(`${value},${shape.points[index + 1]}`);
      return parts;
    }, []).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${shape.color}" stroke-width="${shape.opacity ? Math.max(shape.strokeWidth, 18) : shape.strokeWidth}" opacity="${shape.opacity ?? 1}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const layout = layoutText(shape);
  const anchor = shape.textAlign === "center" ? "middle" : shape.textAlign === "right" ? "end" : "start";
  const textX = anchor === "start" ? layout.x : anchor === "middle" ? layout.x + layout.width / 2 : layout.x + layout.width;
  const textY = shape.width ? shape.y + layout.fontSize * 0.46 : shape.y;
  return `<text x="${textX}" y="${textY}" fill="${shape.color}" font-family="${escapeAttr(layout.fontFamily)}" font-size="${layout.fontSize}" font-weight="650" text-anchor="${anchor}" dominant-baseline="hanging" transform="rotate(${shape.angle ?? 0} ${shape.x} ${shape.y})">${textLines(textX, layout.lines, layout.fontSize, layout.lineHeight)}</text>`;
}

function textLines(x: number, lines: string[], fontSize: number, lineHeight: number): string {
  return lines.map((line, index) => {
    const dy = index === 0 ? 0 : fontSize * lineHeight;
    return `<tspan x="${x}" dy="${dy}">${escapeText(line)}</tspan>`;
  }).join("");
}

function escapeAttr(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
