#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderAdapterToPng, type RenderAdapter } from "./adapter-render";
import { readClipboardImage } from "./clipboard";
import { extractSceneMetadata } from "./png-metadata";
import { renderSceneToPng } from "./render";
import { startQuickPaintServer, type CliMode, type QuickPaintResult } from "./server";
import { focusedAppBundleId, pasteTextIntoApp } from "./sinks";
import { captureScreenshot } from "./screenshot";
import { isSceneSpec, normalizeScene, type SceneSpec } from "./spec";

type BrowserOptions = {
  kind: "browser";
  mode: CliMode;
  json: boolean;
  paste: boolean;
};

type RenderOptions = {
  kind: "render";
  source: { kind: "spec"; value: unknown } | { kind: RenderAdapter; value: string };
  outPath: string;
  json: boolean;
  paste: boolean;
};

type InspectOptions = {
  kind: "inspect";
  path: string;
  json: boolean;
};

type CliOptions = BrowserOptions | RenderOptions | InspectOptions;

const usage = [
  "usage:",
  "  quick-paint [--json] [--paste]",
  "  quick-paint edit <image> [--spec scene.json] [--json] [--paste]",
  "  quick-paint paste [--spec scene.json] [--json] [--paste]",
  "  quick-paint shot [--spec scene.json] [--json] [--paste]",
  "  quick-paint open [--spec scene.json] [image] [--json] [--paste]",
  "  quick-paint render --spec scene.json|- --out file.png [--json] [--paste]",
  "  quick-paint render --mermaid file.mmd|- --out file.png [--json] [--paste]",
  "  quick-paint render --dot graph.dot|- --out file.png [--json] [--paste]",
  "  quick-paint inspect <image.png> [--json]"
].join("\n");

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    process.exit(0);
  }
  const json = takeFlag(args, "--json");
  const paste = takeFlag(args, "--paste");

  if (args.length === 0) return { kind: "browser", mode: { kind: "blank" }, json, paste };

  const command = args.shift();
  if (command === "render") {
    const source = readRenderSource(args);
    const outPath = takeOption(args, "--out", true);
    rejectExtra(args);
    return { kind: "render", source, outPath: resolve(outPath), json, paste };
  }

  if (command === "inspect") {
    const file = args.shift();
    if (!file) throw new Error(usage);
    rejectExtra(args);
    return { kind: "inspect", path: resolve(file), json };
  }

  if (command === "open") {
    const spec = readOptionalSpec(args);
    const file = args.shift();
    rejectExtra(args);
    if (!file) return { kind: "browser", mode: { kind: "blank", scene: spec }, json, paste };
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`file not found: ${file}`);
    return { kind: "browser", mode: imageMode(path, spec), json, paste };
  }

  if (command === "edit") {
    const file = args.shift();
    if (!file) throw new Error(usage);
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`file not found: ${file}`);
    return { kind: "browser", mode: imageMode(path, spec), json, paste };
  }

  if (command === "paste") {
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    const path = readClipboardImage();
    if (!path) throw new Error("clipboard does not contain a PNG image");
    return { kind: "browser", mode: { kind: "edit", path, scene: spec }, json, paste };
  }

  if (command === "shot") {
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    return { kind: "browser", mode: { kind: "edit", path: captureScreenshot(), scene: spec }, json, paste };
  }

  throw new Error(usage);
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], name: string, required = false): string {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new Error(`${name} is required`);
    return "";
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function readOptionalSpec(args: string[]): SceneSpec | undefined {
  const specPath = takeOption(args, "--spec");
  if (!specPath) return undefined;
  const spec = readJsonSpec(specPath);
  if (!isSceneSpec(spec)) throw new Error("scene spec must be a JSON object with canvas and/or shapes");
  normalizeScene(spec);
  return spec;
}

function readRenderSource(args: string[]): RenderOptions["source"] {
  const flags = [
    { name: "--spec", kind: "spec" as const },
    { name: "--mermaid", kind: "mermaid" as const },
    { name: "--dot", kind: "dot" as const }
  ];
  const present = flags.flatMap((flag) => args.includes(flag.name) ? [flag] : []);
  if (present.length !== 1) throw new Error("render requires exactly one of --spec, --mermaid, or --dot");
  const flag = present[0];
  const path = takeOption(args, flag.name, true);
  if (flag.kind === "spec") return { kind: "spec", value: readJsonSpec(path) };
  return { kind: flag.kind, value: readText(path) };
}

function readJsonSpec(path: string): unknown {
  return JSON.parse(readText(path));
}

function readText(path: string): string {
  return path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
}

function rejectExtra(args: string[]) {
  if (args.length > 0) throw new Error(`unexpected arguments: ${args.join(" ")}\n${usage}`);
}

function imageMode(path: string, scene: SceneSpec | undefined): CliMode {
  return { kind: "edit", path, scene };
}

function printResult(result: QuickPaintResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`@${result.path}`);
}

function printInspect(scene: unknown, json: boolean) {
  const text = JSON.stringify(scene, null, json ? 2 : 0);
  console.log(text);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.kind === "inspect") {
    const scene = extractSceneMetadata(readFileSync(options.path));
    if (!scene) throw new Error(`no quick-paint scene metadata found: ${options.path}`);
    printInspect(scene, options.json);
    return;
  }

  const pasteTarget = options.paste ? focusedAppBundleId() : null;
  if (options.kind === "render") {
    const result = options.source.kind === "spec"
      ? renderSceneToPng(options.source.value, { outPath: options.outPath, clipboard: true })
      : renderAdapterToPng(options.source.kind, options.source.value, { outPath: options.outPath, clipboard: true });
    printResult(result, options.json);
    if (options.paste) pasteTextIntoApp(`@${result.path}`, pasteTarget);
    return;
  }

  const session = await startQuickPaintServer(options.mode, { open: process.env.QUICK_PAINT_NO_OPEN !== "1" });
  if (process.env.QUICK_PAINT_URL_FILE) writeFileSync(process.env.QUICK_PAINT_URL_FILE, session.url);
  try {
    const result = await session.result;
    printResult(result, options.json);
    if (options.paste) pasteTextIntoApp(`@${result.path}`, pasteTarget);
  } finally {
    session.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
