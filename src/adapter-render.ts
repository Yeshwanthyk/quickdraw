import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyImageToClipboard } from "./clipboard";
import { completeQuickdrawResult, type QuickdrawResult } from "./context";
import { embedSceneMetadata } from "./png-metadata";
import { renderSvgToPng } from "./render";

export type RenderAdapter = "dot" | "mermaid";

type AdapterRenderOptions = {
  outPath: string;
  clipboard?: boolean;
};

export function renderAdapterToPng(adapter: RenderAdapter, source: string, options: AdapterRenderOptions): QuickdrawResult {
  mkdirSync(dirname(options.outPath), { recursive: true });
  if (adapter === "dot") renderDotToPng(source, options.outPath);
  else renderMermaidToPng(source, options.outPath);

  const png = readFileSync(options.outPath);
  writeFileSync(options.outPath, embedSceneMetadata(png, { adapter, source }));
  const size = pngSize(readFileSync(options.outPath));
  let clipboard = false;
  if (options.clipboard) {
    try {
      clipboard = copyImageToClipboard(options.outPath);
    } catch {
      clipboard = false;
    }
  }
  return completeQuickdrawResult({ path: options.outPath, mime: "image/png", width: size.width, height: size.height, clipboard });
}

function renderDotToPng(source: string, outPath: string) {
  const tmp = mkdtempSync(join(tmpdir(), "quickdraw-dot-"));
  const dotPath = join(tmp, "graph.dot");
  const svgPath = join(tmp, "graph.svg");
  try {
    writeFileSync(dotPath, source);
    if (!run(["dot", "-Tsvg", dotPath, "-o", svgPath])) {
      const wasm = Bun.spawnSync(["bunx", "@hpcc-js/wasm-graphviz-cli", "-T", "svg", dotPath], { stdout: "pipe", stderr: "pipe" });
      if (!wasm.success) {
        throw new Error(`failed to render DOT. Install graphviz/dot or allow bunx @hpcc-js/wasm-graphviz-cli.\n${wasm.stderr.toString()}`);
      }
      writeFileSync(svgPath, wasm.stdout);
    }
    renderSvgToPng(svgPath, outPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function renderMermaidToPng(source: string, outPath: string) {
  const tmp = mkdtempSync(join(tmpdir(), "quickdraw-mermaid-"));
  const inputPath = join(tmp, "diagram.mmd");
  try {
    writeFileSync(inputPath, source);
    if (run(["mmdc", "-i", inputPath, "-o", outPath, "-b", "white"])) return;
    const result = Bun.spawnSync(["bunx", "@mermaid-js/mermaid-cli", "-i", inputPath, "-o", outPath, "-b", "white"], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (!result.success) {
      throw new Error(`failed to render Mermaid. Install mermaid-cli/mmdc or allow bunx @mermaid-js/mermaid-cli.\n${result.stderr.toString()}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function run(command: string[]) {
  try {
    const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
    return result.success;
  } catch {
    return false;
  }
}

function pngSize(png: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, signature.length).equals(signature)) {
    throw new Error("invalid PNG signature");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
