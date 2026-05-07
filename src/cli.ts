#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readClipboardImage } from "./clipboard";
import { startQuickPaintServer, type CliMode, type QuickPaintResult } from "./server";
import { focusedAppBundleId, pasteTextIntoApp } from "./sinks";
import { captureScreenshot } from "./screenshot";

type CliOptions = {
  mode: CliMode;
  json: boolean;
  paste: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log("usage: quick-paint [--json] [--paste] | quick-paint edit <image> [--json] [--paste] | quick-paint paste [--json] [--paste] | quick-paint shot [--json] [--paste]");
    process.exit(0);
  }
  const jsonIndex = args.indexOf("--json");
  const json = jsonIndex !== -1;
  if (json) args.splice(jsonIndex, 1);
  const pasteIndex = args.indexOf("--paste");
  const paste = pasteIndex !== -1;
  if (paste) args.splice(pasteIndex, 1);

  if (args.length === 0) return { mode: { kind: "blank" }, json, paste };

  const [command, file] = args;
  if (command === "edit" && file) {
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`file not found: ${file}`);
    return { mode: { kind: "edit", path }, json, paste };
  }

  if (command === "paste" && !file) {
    const path = readClipboardImage();
    if (!path) throw new Error("clipboard does not contain a PNG image");
    return { mode: { kind: "edit", path }, json, paste };
  }

  if (command === "shot" && !file) {
    return { mode: { kind: "edit", path: captureScreenshot() }, json, paste };
  }

  throw new Error(`usage: quick-paint [--json] [--paste] | quick-paint edit <image> [--json] [--paste] | quick-paint paste [--json] [--paste] | quick-paint shot [--json] [--paste]`);
}

function printResult(result: QuickPaintResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`@${result.path}`);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const pasteTarget = options.paste ? focusedAppBundleId() : null;
  const session = await startQuickPaintServer(options.mode);
  const result = await session.result;
  session.stop();
  printResult(result, options.json);
  if (options.paste) pasteTextIntoApp(`@${result.path}`, pasteTarget);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
