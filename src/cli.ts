#!/usr/bin/env bun
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderAdapterToPng, type RenderAdapter } from "./adapter-render";
import { readClipboardImage } from "./clipboard";
import { contextFormats, formatQuickdrawContext, type ContextFormat, type QuickdrawResult } from "./context";
import { extractSceneMetadata } from "./png-metadata";
import { renderAsciiToPng, renderSceneToAscii, renderSceneToPng } from "./render";
import { startQuickdrawServer, type CliMode } from "./server";
import { focusedAppBundleId, pasteTextIntoApp } from "./sinks";
import { captureScreenshot } from "./screenshot";
import { isSceneSpec, normalizeScene, type SceneSpec } from "./spec";

type BrowserOptions = {
  kind: "browser";
  mode: CliMode;
  json: boolean;
  context?: ContextFormat;
  paste: boolean;
};

type RenderOptions = {
  kind: "render";
  source: { kind: "spec"; value: unknown } | { kind: RenderAdapter; value: string };
  outPath: string;
  ascii: boolean;
  json: boolean;
  context?: ContextFormat;
  paste: boolean;
};

type InspectOptions = {
  kind: "inspect";
  path: string;
  json: boolean;
};

type UpgradeOptions = { kind: "upgrade" };

type VersionOptions = { kind: "version" };

type CliOptions = BrowserOptions | RenderOptions | InspectOptions | UpgradeOptions | VersionOptions;

const repo = "Yeshwanthyk/quickdraw";

const usage = [
  "usage:",
  "  quickdraw [--json] [--paste]",
  "  quickdraw edit <image> [--spec scene.json] [--json] [--paste]",
  "  quickdraw paste [--spec scene.json] [--json] [--paste]",
  "  quickdraw shot [--spec scene.json] [--json] [--paste]",
  "  quickdraw open [--spec scene.json] [image] [--json] [--paste]",
  "  quickdraw render --spec scene.json|- --out file.png [--json] [--paste]",
  "  quickdraw render --spec scene.json|- --ascii [--out file.txt|file.png] [--json] [--paste]",
  "  quickdraw render --mermaid file.mmd|- --out file.png [--json] [--paste]",
  "  quickdraw render --dot graph.dot|- --out file.png [--json] [--paste]",
  "  quickdraw inspect <image.png> [--json]",
  "  quickdraw upgrade",
  "  quickdraw version",
  "",
  "output:",
  "  --context token|markdown|json|codex  print/paste an agent handoff context"
].join("\n");

function currentVersion(): string {
  if (process.env.QUICKDRAW_VERSION) return process.env.QUICKDRAW_VERSION;
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (parsed && typeof parsed === "object" && "version" in parsed && typeof parsed.version === "string") return parsed.version;
  } catch {
    // fall through to unknown
  }
  return "unknown";
}

async function latestReleaseTag(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "quickdraw-cli" }
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "tag_name" in body && typeof body.tag_name === "string") return body.tag_name;
  } catch {
    // network failure — treated as unknown
  }
  return null;
}

// The installed command is a self-extracting wrapper that runs from a cache dir, so it exports
// its own path as QUICKDRAW_SELF for us to overwrite. Dev runs (bun run src/cli.ts) lack it.
async function upgrade(): Promise<void> {
  const target = process.env.QUICKDRAW_SELF;
  if (!target) throw new Error("`quickdraw upgrade` only works on an installed quickdraw binary");
  const current = currentVersion();
  const tag = await latestReleaseTag();
  const res = await fetch(`https://github.com/${repo}/releases/latest/download/quickdraw`, {
    headers: { "User-Agent": "quickdraw-cli" }
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const payload = Buffer.from(await res.arrayBuffer());
  if (payload.length < 1024 || !payload.subarray(0, 2).equals(Buffer.from("#!"))) {
    throw new Error("downloaded asset is not an executable script");
  }
  const tmp = join(dirname(target), `.quickdraw-upgrade-${process.pid}`);
  writeFileSync(tmp, payload);
  chmodSync(tmp, 0o755);
  renameSync(tmp, target);
  console.log(`Upgraded quickdraw${tag ? ` to ${tag}` : ""} (was ${current}) at ${target}`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    process.exit(0);
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "version")) {
    return { kind: "version" };
  }
  if (args[0] === "upgrade") {
    args.shift();
    rejectExtra(args);
    return { kind: "upgrade" };
  }
  const json = takeFlag(args, "--json");
  const context = takeContext(args);
  const paste = takeFlag(args, "--paste");

  if (args.length === 0) return { kind: "browser", mode: { kind: "blank" }, json, context, paste };

  const command = args.shift();
  if (command === "render") {
    const source = readRenderSource(args);
    const ascii = takeFlag(args, "--ascii");
    if (ascii && source.kind !== "spec") throw new Error("--ascii requires --spec");
    const outPath = takeOption(args, "--out", !ascii);
    rejectExtra(args);
    return { kind: "render", source, outPath: outPath ? resolve(outPath) : "", ascii, json, context, paste };
  }

  if (command === "inspect") {
    if (context) throw new Error("--context is not supported for inspect");
    const file = args.shift();
    if (!file) throw new Error(usage);
    rejectExtra(args);
    return { kind: "inspect", path: resolve(file), json };
  }

  if (command === "open") {
    const spec = readOptionalSpec(args);
    const file = args.shift();
    rejectExtra(args);
    if (!file) return { kind: "browser", mode: { kind: "blank", scene: spec }, json, context, paste };
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`file not found: ${file}`);
    return { kind: "browser", mode: imageMode(path, spec), json, context, paste };
  }

  if (command === "edit") {
    const file = args.shift();
    if (!file) throw new Error(usage);
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`file not found: ${file}`);
    return { kind: "browser", mode: imageMode(path, spec), json, context, paste };
  }

  if (command === "paste") {
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    const path = readClipboardImage();
    if (!path) throw new Error("clipboard does not contain a PNG image");
    return { kind: "browser", mode: { kind: "edit", path, scene: spec }, json, context, paste };
  }

  if (command === "shot") {
    const spec = readOptionalSpec(args);
    rejectExtra(args);
    return { kind: "browser", mode: { kind: "edit", path: captureScreenshot(), scene: spec }, json, context, paste };
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

function takeContext(args: string[]): ContextFormat | undefined {
  const value = takeOption(args, "--context");
  if (!value) return undefined;
  if (contextFormats.includes(value as ContextFormat)) return value as ContextFormat;
  throw new Error(`--context must be one of ${contextFormats.join(", ")}`);
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

function formatResult(result: QuickdrawResult, json: boolean, context: ContextFormat | undefined) {
  if (context) return formatQuickdrawContext(result, context);
  if (json) {
    return JSON.stringify(result, null, 2);
  }
  return result.token;
}

function printResult(result: QuickdrawResult, json: boolean, context: ContextFormat | undefined) {
  console.log(formatResult(result, json, context));
}

function formatPasteResult(result: QuickdrawResult, context: ContextFormat | undefined) {
  return context ? formatQuickdrawContext(result, context) : result.token;
}

function printInspect(scene: unknown, json: boolean) {
  const text = JSON.stringify(scene, null, json ? 2 : 0);
  console.log(text);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.kind === "version") {
    console.log(currentVersion());
    return;
  }
  if (options.kind === "upgrade") {
    await upgrade();
    return;
  }
  if (options.kind === "inspect") {
    const scene = extractSceneMetadata(readFileSync(options.path));
    if (!scene) throw new Error(`no quickdraw scene metadata found: ${options.path}`);
    printInspect(scene, options.json);
    return;
  }

  const pasteTarget = options.paste ? focusedAppBundleId() : null;
  if (options.kind === "render") {
    if (options.ascii && options.source.kind === "spec") {
      if (options.context && !options.outPath.toLowerCase().endsWith(".png")) {
        throw new Error("--context requires an image artifact; use --out file.png with --ascii");
      }
      if (options.outPath.toLowerCase().endsWith(".png")) {
        const result = renderAsciiToPng(options.source.value, { outPath: options.outPath, clipboard: true });
        const output = formatResult(result, options.json, options.context);
        console.log(output);
        if (options.paste) pasteTextIntoApp(formatPasteResult(result, options.context), pasteTarget);
        return;
      }
      const ascii = renderSceneToAscii(options.source.value);
      if (options.outPath) writeFileSync(options.outPath, `${ascii}\n`);
      if (options.json) console.log(JSON.stringify({ ascii, path: options.outPath || null }, null, 2));
      else if (options.outPath) console.log(`@${options.outPath}`);
      else console.log(ascii);
      if (options.paste) pasteTextIntoApp(ascii, pasteTarget);
      return;
    }
    const result = options.source.kind === "spec"
      ? renderSceneToPng(options.source.value, { outPath: options.outPath, clipboard: true })
      : renderAdapterToPng(options.source.kind, options.source.value, { outPath: options.outPath, clipboard: true });
    const output = formatResult(result, options.json, options.context);
    console.log(output);
    if (options.paste) pasteTextIntoApp(formatPasteResult(result, options.context), pasteTarget);
    return;
  }

  const session = await startQuickdrawServer(options.mode, { open: process.env.QUICKDRAW_NO_OPEN !== "1" });
  if (process.env.QUICKDRAW_URL_FILE) writeFileSync(process.env.QUICKDRAW_URL_FILE, session.url);
  try {
    const result = await session.result;
    const output = formatResult(result, options.json, options.context);
    console.log(output);
    if (options.paste) pasteTextIntoApp(formatPasteResult(result, options.context), pasteTarget);
  } finally {
    session.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
