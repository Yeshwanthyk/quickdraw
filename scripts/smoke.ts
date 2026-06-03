import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { readClipboardImage } from "../src/clipboard";
import { extractSceneMetadata } from "../src/png-metadata";
import { startQuickdrawServer, type QuickdrawResult } from "../src/server";
import { normalizeScene, type SceneRectSpec, type SceneSpec } from "../src/spec";
import { layoutText } from "../src/text-layout";

declare global {
  interface Window {
    Konva?: { stages?: Array<{ find(selector: string): { length: number } }> };
  }
}

function verifyResult(result: QuickdrawResult) {
  if (!existsSync(result.path)) throw new Error(`missing output: ${result.path}`);
  if (statSync(result.path).size < 100) throw new Error(`empty output: ${result.path}`);
  if (result.mime !== "image/png") throw new Error(`unexpected mime: ${result.mime}`);
  if (result.width <= 0 || result.height <= 0) throw new Error(`bad dimensions: ${result.width}x${result.height}`);
}

type ImageBounds = {
  width: number;
  height: number;
  x: number;
  y: number;
};

function visibleBounds(path: string): ImageBounds {
  const result = Bun.spawnSync([
    "magick",
    path,
    "-alpha", "remove",
    "-fuzz", "1%",
    "-trim",
    "-format", "%w %h %[fx:page.x] %[fx:page.y]",
    "info:"
  ], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`failed to inspect image bounds: ${result.stderr.toString()}`);
  const [width, height, x, y] = result.stdout.toString().trim().split(/\s+/).map(Number);
  if ([width, height, x, y].some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid image bounds output: ${result.stdout.toString()}`);
  }
  return { width, height, x, y };
}

function assertBoundsClose(actual: ImageBounds, expected: ImageBounds, tolerance: number, label: string) {
  for (const key of ["width", "height", "x", "y"] as const) {
    if (Math.abs(actual[key] - expected[key]) > tolerance) {
      throw new Error(`${label} ${key} mismatch: ${actual[key]} !== ${expected[key]} (${JSON.stringify({ actual, expected })})`);
    }
  }
}

function trace(message: string) {
  if (process.env.QUICKDRAW_SMOKE_TRACE === "1") console.error(`[smoke] ${message}`);
}

async function drawAndSave(browser: Awaited<ReturnType<typeof chromium.launch>>, mode: Parameters<typeof startQuickdrawServer>[0]) {
  const session = await startQuickdrawServer(mode, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(session.url);
    // Grid is the default mode now; Pen lives in Paint mode.
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Pen" }).click();
    const stage = page.locator(".stage canvas").first();
    const box = await stage.boundingBox();
    if (!box) throw new Error("missing draw stage");
    await page.mouse.move(box.x + 140, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 210);
    await page.mouse.move(box.x + 340, box.y + 145);
    await page.mouse.move(box.x + 420, box.y + 180);
    await page.mouse.up();
    await page.getByRole("button", { name: "Save" }).click();

    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const pen = scene.shapes.find((shape) => shape.type === "pen");
    if (!pen || pen.type !== "pen") {
      throw new Error("draw smoke did not persist pen stroke metadata");
    }
    const end = pen.points.slice(-2);
    if (Math.abs((end[0] ?? 0) - 420) > 2 || Math.abs((end[1] ?? 0) - 180) > 2 || pen.points.length < 8) {
      throw new Error(`draw smoke lost final pen samples: ${JSON.stringify(pen.points)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function waitForFile(path: string) {
  const start = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function clickStage(page: Page, stage: Locator, x: number, y: number) {
  const box = await stage.boundingBox();
  if (!box) throw new Error("missing stage bounds");
  await page.mouse.click(box.x + x, box.y + y);
}

async function dblclickStage(page: Page, stage: Locator, x: number, y: number) {
  const box = await stage.boundingBox();
  if (!box) throw new Error("missing stage bounds");
  await page.mouse.dblclick(box.x + x, box.y + y);
}

async function drawAndSaveViaCli(browser: Awaited<ReturnType<typeof chromium.launch>>, args: string[], options: { expectedSourceKind?: "blank" | "image" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "quickdraw-cli-smoke-"));
  const urlFile = join(dir, "url");
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args, "--json"], {
    cwd: process.cwd(),
    env: { ...process.env, QUICKDRAW_NO_OPEN: "1", QUICKDRAW_URL_FILE: urlFile },
    stdout: "pipe",
    stderr: "pipe"
  });
  try {
    await waitForFile(urlFile);
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const url = readFileSync(urlFile, "utf8");
    await page.goto(url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    if (options.expectedSourceKind) {
      const sourceKind = await page.evaluate(async () => {
        const source = await fetch("/api/source").then((response) => response.json()) as { kind: string };
        return source.kind;
      });
      if (sourceKind !== options.expectedSourceKind) {
        throw new Error(`unexpected CLI source kind: ${sourceKind} !== ${options.expectedSourceKind}`);
      }
    }
    await page.getByRole("button", { name: "Save" }).click();
    await page.close();
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);
    if (exitCode !== 0) throw new Error(`CLI browser smoke failed\n${stderr}\n${stdout}`);
    const result = JSON.parse(stdout.trim()) as QuickdrawResult;
    verifyResult(result);
    return result;
  } catch (error) {
    proc.kill();
    throw error;
  }
}

async function smokeTextEditor(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const session = await startQuickdrawServer({ kind: "blank" }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await page.getByRole("button", { name: "Text" }).click();
    await clickStage(page, stage, 180, 120);
    await page.getByRole("textbox", { name: "Text" }).fill("Draft");
    await page.getByRole("button", { name: "Align center" }).click();
    const centeredBox = await page.getByRole("textbox", { name: "Text" }).boundingBox();
    const stageBox = await stage.boundingBox();
    if (!centeredBox || !stageBox) throw new Error("missing text editor geometry");
    const centerDelta = Math.abs((centeredBox.x + centeredBox.width / 2) - (stageBox.x + 180));
    if (centerDelta > 2) throw new Error(`centered text editor anchor drifted by ${centerDelta}px`);
    await page.getByLabel("Font family").selectOption("Arial");
    await page.getByLabel("Font size").selectOption("40");
    await page.keyboard.press("Enter");
    await page.getByLabel("Font size").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Select (1)" }).click();
    await dblclickStage(page, stage, 180, 140);
    await page.getByRole("textbox", { name: "Text" }).fill("Edited");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const texts = scene.shapes.filter((shape) => shape.type === "text");
    if (texts.length !== 1) throw new Error(`text editor duplicated text shapes: ${texts.length}`);
    const text = texts[0];
    if (!text || text.type !== "text") throw new Error("text editor did not save edited text");
    if (text.text !== "Edited" || text.textAlign !== "center" || text.fontFamily !== "Arial" || text.fontSize !== 40) {
      throw new Error(`text editor did not preserve formatting: ${JSON.stringify(text)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeSaveActiveText(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const session = await startQuickdrawServer({ kind: "blank" }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await page.getByRole("button", { name: "Text" }).click();
    await clickStage(page, stage, 120, 80);
    await page.getByRole("textbox", { name: "Text" }).fill("Saved from draft");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    if (!scene.shapes.some((shape) => shape.type === "text" && shape.text === "Saved from draft")) {
      throw new Error(`active text draft was not saved: ${JSON.stringify(scene.shapes)}`);
    }
    const bounds = visibleBounds(result.path);
    if (bounds.width < 40 || bounds.height < 10) {
      throw new Error(`active text draft missing from raster: ${JSON.stringify(bounds)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeSelectionTools(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 520, height: 320 },
    shapes: [
      { id: "target-rect", type: "rect", x: 100, y: 100, width: 100, height: 70, color: "blue", label: "Resize" },
      { id: "second-rect", type: "rect", x: 260, y: 100, width: 60, height: 60, color: "green" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    const stageBox = await stage.boundingBox();
    if (!stageBox) throw new Error("missing selection stage");

    await clickStage(page, stage, 130, 130);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");

    await page.mouse.move(stageBox.x + 201, stageBox.y + 175);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 241, stageBox.y + 205);
    await page.mouse.up();

    await page.mouse.move(stageBox.x + 171, stageBox.y + 71);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 240, stageBox.y + 140);
    await page.mouse.up();

    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const rect = scene.shapes.find((shape) => shape.id === "target-rect");
    if (!rect || rect.type !== "rect") throw new Error("selection smoke lost target rect");
    if (rect.x <= 100 || rect.y <= 100 || rect.width <= 100 || rect.height <= 70) {
      throw new Error(`selection transform did not move/resize rect: ${JSON.stringify(rect)}`);
    }
    if (!rect.angle || Math.abs(rect.angle) < 10) {
      throw new Error(`selection transform did not rotate rect: ${JSON.stringify(rect)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeMultiSelectDelete(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 360, height: 220 },
    shapes: [
      { id: "a", type: "rect", x: 40, y: 70, width: 70, height: 50, color: "blue" },
      { id: "b", type: "rect", x: 180, y: 70, width: 70, height: 50, color: "green" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 520 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await clickStage(page, stage, 60, 90);
    await page.keyboard.down("Shift");
    await clickStage(page, stage, 200, 90);
    await page.keyboard.up("Shift");
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    if (scene.shapes.length !== 0) throw new Error(`multi-select delete left shapes behind: ${JSON.stringify(scene.shapes)}`);
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokePreciseLineHit(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 260, height: 240 },
    shapes: [
      { id: "diagonal", type: "pen", points: [40, 40, 200, 200], color: "blue", strokeWidth: 4 }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 680, height: 520 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await clickStage(page, stage, 55, 185);
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    if (!scene.shapes.some((shape) => shape.id === "diagonal")) {
      throw new Error("empty space inside pen bounds selected and deleted the pen stroke");
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeZOrder(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 320, height: 220 },
    shapes: [
      { id: "bottom", type: "rect", x: 80, y: 70, width: 90, height: 70, color: "blue" },
      { id: "middle", type: "rect", x: 105, y: 82, width: 90, height: 70, color: "green" },
      { id: "top", type: "rect", x: 130, y: 94, width: 90, height: 70, color: "red" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 520 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await clickStage(page, stage, 140, 104);
    await page.getByRole("button", { name: "Send to back" }).click();
    await page.keyboard.press("Meta+Z");
    let order = await page.evaluate(() => {
      const source = window.Konva?.stages?.[0];
      return source?.find(".shape-hit").map((node) => node.id()).join(",");
    });
    if (order !== "bottom,middle,top") throw new Error(`undo after z-order did not restore order: ${order}`);
    await clickStage(page, stage, 140, 104);
    await page.getByRole("button", { name: "Send to back" }).click();
    await clickStage(page, stage, 90, 100);
    await page.getByRole("button", { name: "Bring to front" }).click();
    order = await page.evaluate(() => {
      const source = window.Konva?.stages?.[0];
      return source?.find(".shape-hit").map((node) => node.id()).join(",");
    });
    if (order !== "top,middle,bottom") throw new Error(`bring-to-front did not reorder live stage: ${order}`);
    await page.keyboard.down("Shift");
    await clickStage(page, stage, 180, 120);
    await page.keyboard.up("Shift");
    await page.getByRole("button", { name: "Send to back" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    order = scene.shapes.map((shape) => shape.id).join(",");
    if (order !== "middle,bottom,top") throw new Error(`multi-select send-to-back did not preserve selected order: ${order}`);
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeArrowEndpointEditor(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 360, height: 220 },
    shapes: [
      { id: "editable-arrow", type: "arrow", from: [70, 110], to: [220, 110], color: "red", label: "route" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 520 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    const stageBox = await stage.boundingBox();
    if (!stageBox) throw new Error("missing arrow stage");
    await clickStage(page, stage, 150, 110);
    const arrowPointHandles = await page.evaluate(() => {
      const stage = window.Konva?.stages?.[0];
      return stage?.find(".arrow-point-handle").length ?? 0;
    });
    if (arrowPointHandles !== 2) throw new Error(`selected arrow did not show exactly two endpoint handles: ${arrowPointHandles}`);
    const genericResizeHandles = await page.evaluate(() => {
      const stage = window.Konva?.stages?.[0];
      return stage?.find(".resize-handle").length ?? 0;
    });
    if (genericResizeHandles !== 0) throw new Error(`selected arrow still exposed generic resize handles: ${genericResizeHandles}`);
    await page.mouse.move(stageBox.x + 220, stageBox.y + 110);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 270, stageBox.y + 162);
    await page.mouse.up();
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const arrow = scene.shapes.find((shape) => shape.id === "editable-arrow");
    if (!arrow || arrow.type !== "arrow") throw new Error("arrow endpoint smoke lost arrow");
    const [x1, y1, x2, y2] = arrow.points;
    if (Math.abs(x1 - 70) > 1 || Math.abs(y1 - 110) > 1 || x2 < 260 || y2 < 150) {
      throw new Error(`arrow endpoint editor did not update only the dragged endpoint: ${JSON.stringify(arrow.points)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeGridDraw(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const session = await startQuickdrawServer({ kind: "blank" }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Grid mode (ASCII)" }).click();
    // Appearance panel: pick double border + dense fill, applied to the next shape.
    await page.getByRole("button", { name: "Double", exact: true }).click();
    await page.getByRole("button", { name: "Dense", exact: true }).click();
    await page.getByRole("button", { name: "Rectangle (4)" }).click();
    const canvas = page.locator(".gridCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("missing grid canvas");
    // Grid view at default pan (24,24) + 20px ruler: cell (c,r) -> (24 + c*12, 44 + r*22).
    await page.mouse.move(box.x + 24 + 5 * 12, box.y + 44 + 3 * 22);
    await page.mouse.down();
    await page.mouse.move(box.x + 24 + 15 * 12, box.y + 44 + 8 * 22);
    await page.mouse.up();
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const rect = scene.shapes.find((shape) => shape.type === "rect");
    // cells -> scene px via 8x16: x=5*8, y=3*16, w=10*8, h=5*16; plus panel styles.
    if (!rect || rect.type !== "rect" || rect.x !== 40 || rect.y !== 48 || rect.width !== 80 || rect.height !== 80) {
      throw new Error(`grid draw did not snap rect to cells: ${JSON.stringify(rect)}`);
    }
    if (rect.strokeStyle !== "double" || rect.fillStyle !== "dense") {
      throw new Error(`appearance panel style not applied to grid shape: ${JSON.stringify(rect)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeGridEdit(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = { canvas: { width: 640, height: 400 }, shapes: [{ id: "r", type: "rect", x: 32, y: 48, width: 64, height: 64, color: "blue", label: "box" }] };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Grid mode (ASCII)" }).click();
    await page.getByRole("button", { name: "Select (1)" }).click();
    const box = await page.locator(".gridCanvas").boundingBox();
    if (!box) throw new Error("missing grid canvas");
    // rect spans cells (4,3)-(12,7); click inside (8,5) and drag to (11,8): +3 col, +3 row.
    await page.mouse.move(box.x + 24 + 8 * 12, box.y + 44 + 5 * 22);
    await page.mouse.down();
    await page.mouse.move(box.x + 24 + 11 * 12, box.y + 44 + 8 * 22);
    await page.mouse.up();
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const rect = scene.shapes.find((shape) => shape.id === "r");
    // +3 cells -> +24px x, +48px y: x 32->56, y 48->96.
    if (!rect || rect.type !== "rect" || rect.x !== 56 || rect.y !== 96) {
      throw new Error(`grid select+move did not translate by whole cells: ${JSON.stringify(rect)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeGridText(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const session = await startQuickdrawServer({ kind: "blank" }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Grid mode (ASCII)" }).click();
    await page.getByRole("button", { name: "Text (5)" }).click();
    const box = await page.locator(".gridCanvas").boundingBox();
    if (!box) throw new Error("missing grid canvas");
    // Escape must cancel without committing.
    await page.mouse.click(box.x + 24 + 5 * 12, box.y + 44 + 2 * 22);
    await page.getByRole("textbox", { name: "Grid text" }).fill("discard");
    await page.keyboard.press("Escape");
    // Enter commits at the clicked cell.
    await page.mouse.click(box.x + 24 + 10 * 12, box.y + 44 + 4 * 22);
    await page.getByRole("textbox", { name: "Grid text" }).fill("hello");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const texts = scene.shapes.filter((shape) => shape.type === "text");
    const text = texts[0];
    // cell (10,4) -> x 80, y 64; Escape draft must not have committed.
    if (texts.length !== 1 || !text || text.type !== "text" || text.text !== "hello" || text.x !== 80 || text.y !== 64) {
      throw new Error(`grid text tool (escape-cancel / enter-commit) wrong: ${JSON.stringify(texts)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeGridCopyAscii(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = { canvas: { width: 320, height: 160 }, shapes: [{ type: "rect", x: 24, y: 24, width: 96, height: 64, color: "blue", label: "API" }] };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
  try {
    const page = await context.newPage();
    await page.goto(session.url);
    await page.getByRole("button", { name: "Grid mode (ASCII)" }).click();
    await page.getByRole("button", { name: "Copy ASCII" }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!clip.includes("┌") || !clip.includes("│") || !clip.includes("API")) {
      throw new Error(`Copy ASCII did not put a box-drawing diagram on the clipboard:\n${clip}`);
    }
    await page.close();
  } finally {
    await context.close();
    session.stop();
  }
}

async function smokeArrowBinding(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 380, height: 240 },
    shapes: [
      { id: "box", type: "rect", x: 140, y: 70, width: 90, height: 70, color: "blue", label: "Bind" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 560 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    const stageBox = await stage.boundingBox();
    if (!stageBox) throw new Error("missing arrow binding stage");

    // Draw an arrow whose end lands at the rect center (185,105) → end binds to the rect.
    await page.getByRole("button", { name: "Arrow (4)" }).click();
    await page.mouse.move(stageBox.x + 50, stageBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 120, stageBox.y + 150);
    await page.mouse.move(stageBox.x + 185, stageBox.y + 105);
    await page.mouse.up();

    // Select the rect (corner clear of the arrow) and nudge it +25,+25.
    await page.getByRole("button", { name: "Select (1)" }).click();
    await clickStage(page, stage, 218, 130);
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("Shift+ArrowRight");
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("Shift+ArrowDown");

    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const arrow = scene.shapes.find((shape) => shape.type === "arrow");
    if (!arrow || arrow.type !== "arrow") throw new Error("arrow binding smoke lost arrow");
    if (arrow.endBinding?.shapeId !== "box") {
      throw new Error(`arrow end did not bind to rect on draw: ${JSON.stringify(arrow)}`);
    }
    if (arrow.startBinding) {
      throw new Error(`free arrow start should not bind: ${JSON.stringify(arrow.startBinding)}`);
    }
    const [x1, y1, x2, y2] = arrow.points;
    // Rect moved +25,+25 → new center ~ (210,130); the bound end must follow it.
    if (Math.abs(x2 - 210) > 12 || Math.abs(y2 - 130) > 12) {
      throw new Error(`bound arrow end did not follow moved rect: ${JSON.stringify(arrow.points)}`);
    }
    if (Math.abs(x1 - 50) > 6 || Math.abs(y1 - 200) > 6) {
      throw new Error(`free arrow start drifted: ${JSON.stringify(arrow.points)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeRotatedTextEdit(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const spec: SceneSpec = {
    canvas: { width: 420, height: 260 },
    shapes: [
      { id: "rotated-text", type: "text", x: 190, y: 120, text: "Rotate", color: "dark", fontSize: 32, textAlign: "center", angle: 33 }
    ]
  };
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 560 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await dblclickStage(page, stage, 190, 140);
    await page.getByRole("textbox", { name: "Text" }).fill("Edited rotation");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    const text = scene.shapes.find((shape) => shape.id === "rotated-text");
    if (!text || text.type !== "text" || text.text !== "Edited rotation" || Math.abs((text.angle ?? 0) - 33) > 0.1) {
      throw new Error(`rotated text edit did not preserve angle: ${JSON.stringify(text)}`);
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function smokeRotatedTextParity(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const dir = mkdtempSync(join(tmpdir(), "quickdraw-rotated-parity-"));
  const headlessPath = join(dir, "headless.png");
  const spec: SceneSpec = {
    canvas: { width: 420, height: 260 },
    shapes: [
      { type: "text", x: 190, y: 118, text: "Rotated WWW", color: "dark", fontSize: 32, fontFamily: "Arial", textAlign: "center", angle: 33 }
    ]
  };
  runCli(["render", "--spec", "-", "--out", headlessPath, "--json"], JSON.stringify(spec));
  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 560 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const browserResult = await session.result;
    verifyResult(browserResult);
    assertBoundsClose(visibleBounds(browserResult.path), visibleBounds(headlessPath), 8, "rotated text browser/headless bounds");
    await page.close();
    return browserResult;
  } finally {
    session.stop();
  }
}

async function smokeWrappedText(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  trace("wrapped: start");
  const dir = mkdtempSync(join(tmpdir(), "quickdraw-wrapped-text-"));
  const headlessPath = join(dir, "headless.png");
  const wrappedLines = layoutText({ id: "wrap", type: "text", x: 0, y: 0, width: 126, text: "MMMM test", color: "#111827", strokeWidth: 4, fontSize: 24, fontFamily: "Arial" }).lines;
  if (wrappedLines.length !== 2) throw new Error(`fixed-width text did not wrap deterministically: ${JSON.stringify(wrappedLines)}`);
  const longTokenLines = layoutText({ id: "long", type: "text", x: 0, y: 0, width: 86, text: "MMMMMMMMMMMM", color: "#111827", strokeWidth: 4, fontSize: 24, fontFamily: "Arial" }).lines;
  if (longTokenLines.length < 2 || longTokenLines.some((line) => line.length > 4)) {
    throw new Error(`leading long token was not split: ${JSON.stringify(longTokenLines)}`);
  }
  const spec: SceneSpec = {
    canvas: { width: 360, height: 220 },
    shapes: [
      { type: "text", x: 48, y: 36, width: 126, text: "Alpha beta gamma delta", originalText: " Alpha beta gamma delta\n", color: "dark", fontSize: 24, lineHeight: 1.25 }
    ]
  };
  runCli(["render", "--spec", "-", "--out", headlessPath, "--json"], JSON.stringify(spec));
  trace("wrapped: headless rendered");
  verifySceneMetadata(headlessPath, spec);
  const headlessBounds = visibleBounds(headlessPath);
  if (headlessBounds.height < 52) throw new Error(`headless wrapped text did not span multiple lines: ${JSON.stringify(headlessBounds)}`);

  const session = await startQuickdrawServer({ kind: "blank", scene: spec }, { open: false });
  try {
    trace("wrapped: browser session started");
    const page = await browser.newPage({ viewport: { width: 760, height: 520 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    const browserResult = await session.result;
    trace("wrapped: browser saved");
    verifyResult(browserResult);
    verifySceneMetadata(browserResult.path, spec);
    const browserBounds = visibleBounds(browserResult.path);
    assertBoundsClose(browserBounds, headlessBounds, 6, "wrapped text browser/headless bounds");
    const roundTrip = normalizeScene(JSON.parse(runCli(["inspect", browserResult.path, "--json"])));
    const text = roundTrip.shapes.find((shape) => shape.type === "text");
    if (!text || text.type !== "text" || text.originalText !== " Alpha beta gamma delta\n") {
      throw new Error(`wrapped text originalText did not round-trip: ${JSON.stringify(text)}`);
    }
    if (browserBounds.height < 52) throw new Error(`browser wrapped text did not span multiple lines: ${JSON.stringify(browserBounds)}`);
    await page.close();
    session.stop();
    const reopen = await startQuickdrawServer({ kind: "blank", scene: roundTrip }, { open: false });
    reopen.result.catch(() => {});
    try {
      trace("wrapped: reopen session started");
      const editPage = await browser.newPage({ viewport: { width: 760, height: 520 } });
      await editPage.goto(reopen.url);
      await editPage.getByRole("button", { name: "Paint mode" }).click();
      trace("wrapped: reopen page loaded");
      const stage = editPage.locator(".stage canvas").first();
      // The wrapped text block renders below its y origin; click into the rendered lines.
      await dblclickStage(editPage, stage, 60, 88);
      trace("wrapped: double clicked");
      const editor = editPage.getByRole("textbox", { name: "Text" });
      await editor.waitFor({ timeout: 3000 });
      trace("wrapped: editor visible");
      const editorValue = await editor.inputValue();
      if (editorValue !== " Alpha beta gamma delta\n") {
        throw new Error(`wrapped text editor did not restore originalText: ${JSON.stringify(editorValue)}`);
      }
      await editPage.evaluate(() => fetch("/api/cancel", { method: "POST" }));
      trace("wrapped: reopen cancelled");
      await editPage.close();
    } finally {
      reopen.stop();
    }
    return browserResult;
  } finally {
    session.stop();
  }
}

async function smokeImageBackedDeselect(browser: Awaited<ReturnType<typeof chromium.launch>>, imagePath: string) {
  const spec: SceneSpec = {
    shapes: [
      { id: "image-text", type: "text", x: 180, y: 120, text: "on image", color: "dark" }
    ]
  };
  const session = await startQuickdrawServer({ kind: "edit", path: imagePath, scene: spec }, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Paint mode" }).click();
    const stage = page.locator(".stage canvas").first();
    await clickStage(page, stage, 180, 130);
    await clickStage(page, stage, 20, 20);
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "Save" }).click();
    const result = await session.result;
    verifyResult(result);
    const scene = normalizeScene(extractSceneMetadata(readFileSync(result.path)));
    if (!scene.shapes.some((shape) => shape.id === "image-text")) {
      throw new Error("image-backed deselect failed; Delete removed the text after background click");
    }
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

function runCli(args: string[], input?: string) {
  const result = Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    stdin: input ? Buffer.from(input) : undefined,
    stdout: "pipe",
    stderr: "pipe"
  });
  if (!result.success) {
    throw new Error(`quickdraw ${args.join(" ")} failed\n${result.stderr.toString()}\n${result.stdout.toString()}`);
  }
  return result.stdout.toString().trim();
}

async function expectCliRejects(args: string[], expectedMessage: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, QUICKDRAW_NO_OPEN: "1" },
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000))
  ]);
  if (exitCode === "timeout") {
    proc.kill();
    throw new Error(`CLI did not reject invalid args quickly: ${args.join(" ")}`);
  }
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (exitCode === 0) {
    throw new Error(`CLI unexpectedly accepted invalid args: ${args.join(" ")}\n${stdout}`);
  }
  if (!stderr.includes(expectedMessage)) {
    throw new Error(`CLI rejection did not include ${expectedMessage}: ${stderr}`);
  }
}

function verifySceneMetadata(path: string, expected: SceneSpec, expectedExtraShapes = 0, canvasFallback?: SceneSpec["canvas"]) {
  const scene = extractSceneMetadata(readFileSync(path));
  if (!scene) throw new Error(`missing embedded scene metadata: ${path}`);
  const normalized = normalizeScene(scene);
  const expectedNormalized = normalizeScene(expected, { canvasFallback });
  if (normalized.canvas.width !== expectedNormalized.canvas.width || normalized.canvas.height !== expectedNormalized.canvas.height) {
    throw new Error(`metadata dimensions mismatch: ${normalized.canvas.width}x${normalized.canvas.height}`);
  }
  const expectedShapeCount = expectedNormalized.shapes.length + expectedExtraShapes;
  if (normalized.shapes.length !== expectedShapeCount) {
    throw new Error(`metadata shape count mismatch: ${normalized.shapes.length} !== ${expectedShapeCount}`);
  }
  expectedNormalized.shapes.forEach((shape, index) => {
    if (JSON.stringify(normalized.shapes[index]) !== JSON.stringify(shape)) {
      throw new Error(`metadata shape mismatch at ${index}: ${JSON.stringify(normalized.shapes[index])} !== ${JSON.stringify(shape)}`);
    }
  });
}

async function smokeCliRenderInspect() {
  const dir = mkdtempSync(join(tmpdir(), "quickdraw-smoke-"));
  const outPath = join(dir, "render.png");
  const spec: SceneSpec = {
    canvas: { width: 420, height: 240 },
    shapes: [
      { type: "rect", x: 24, y: 64, width: 132, height: 72, color: "blue", label: "Spec" },
      { type: "arrow", from: [158, 100], to: [260, 100], color: "red", label: "flow" },
      { type: "text", x: 280, y: 108, text: "AI-first", color: "dark", fontSize: 22, fontFamily: "Arial", textAlign: "right" },
      { type: "highlight", points: [274, 126, 382, 126], color: "yellow" }
    ]
  };
  const stdout = runCli(["render", "--spec", "-", "--out", outPath, "--json"], JSON.stringify(spec));
  const result = JSON.parse(stdout) as QuickdrawResult;
  verifyResult(result);
  if (result.path !== outPath) throw new Error(`render wrote unexpected path: ${result.path}`);
  verifySceneMetadata(outPath, spec);

  const inspected = JSON.parse(runCli(["inspect", outPath, "--json"]));
  const inspectedScene = normalizeScene(inspected);
  if (inspectedScene.shapes.length !== normalizeScene(spec).shapes.length) {
    throw new Error("inspect did not return embedded scene");
  }

  // Arrow connector: an end binding must survive render → embed → inspect round-trip.
  const bindingSpec: SceneSpec = {
    canvas: { width: 300, height: 200 },
    shapes: [
      { id: "box", type: "rect", x: 120, y: 70, width: 90, height: 70, color: "blue" },
      { id: "wire", type: "arrow", from: [40, 180], to: [165, 105], color: "red", endBinding: { shapeId: "box", ratio: [0.5, 0.5] } }
    ]
  };
  const bindingPath = join(dir, "binding.png");
  runCli(["render", "--spec", "-", "--out", bindingPath, "--json"], JSON.stringify(bindingSpec));
  const bindingMeta = normalizeScene(JSON.parse(runCli(["inspect", bindingPath, "--json"])));
  const boundArrow = bindingMeta.shapes.find((shape) => shape.id === "wire");
  if (!boundArrow || boundArrow.type !== "arrow" || boundArrow.endBinding?.shapeId !== "box") {
    throw new Error(`arrow binding did not round-trip through PNG metadata: ${JSON.stringify(boundArrow)}`);
  }

  const dot = "digraph { A -> B; B -> C }";
  const dotPath = join(dir, "dot.png");
  const dotResult = JSON.parse(runCli(["render", "--dot", "-", "--out", dotPath, "--json"], dot)) as QuickdrawResult;
  verifyResult(dotResult);
  const dotMetadata = JSON.parse(runCli(["inspect", dotPath, "--json"])) as { adapter?: string; source?: string };
  if (dotMetadata.adapter !== "dot" || dotMetadata.source !== dot) {
    throw new Error(`DOT metadata mismatch: ${JSON.stringify(dotMetadata)}`);
  }

  const mermaid = "graph LR; A-->B; B-->C";
  const mermaidPath = join(dir, "mermaid.png");
  const mermaidResult = JSON.parse(runCli(["render", "--mermaid", "-", "--out", mermaidPath, "--json"], mermaid)) as QuickdrawResult;
  verifyResult(mermaidResult);
  const mermaidMetadata = JSON.parse(runCli(["inspect", mermaidPath, "--json"])) as { adapter?: string; source?: string };
  if (mermaidMetadata.adapter !== "mermaid" || mermaidMetadata.source !== mermaid) {
    throw new Error(`Mermaid metadata mismatch: ${JSON.stringify(mermaidMetadata)}`);
  }
  const adapterMetadataPath = join(dir, "adapter-metadata.json");
  writeFileSync(adapterMetadataPath, JSON.stringify(mermaidMetadata));
  await expectCliRejects(["open", "--spec", adapterMetadataPath, mermaidPath, "--json"], "scene spec must be a JSON object with canvas and/or shapes");

  const malformedSpecPath = join(dir, "malformed-scene.json");
  writeFileSync(malformedSpecPath, JSON.stringify({ shapes: [{}] }));
  await expectCliRejects(["open", "--spec", malformedSpecPath, "--json"], "shape 0 must include a type");
}

async function smokeAsciiRender() {
  const dir = mkdtempSync(join(tmpdir(), "quickdraw-ascii-"));
  const ascii = (spec: SceneSpec) => runCli(["render", "--spec", "-", "--ascii"], JSON.stringify(spec));
  const hasGlyphs = (text: string, glyphs: string[], label: string) => {
    for (const glyph of glyphs) if (!text.includes(glyph)) throw new Error(`${label} missing ${glyph}:\n${text}`);
  };
  const box = (extra: Partial<SceneRectSpec>): SceneSpec => ({
    canvas: { width: 176, height: 110 },
    shapes: [{ type: "rect", x: 16, y: 16, width: 128, height: 64, color: "blue", ...extra }]
  });

  hasGlyphs(ascii(box({})), ["┌", "┐", "└", "┘", "─", "│"], "single box");
  hasGlyphs(ascii(box({ strokeStyle: "bold" })), ["┏", "┓", "┗", "┛", "━", "┃"], "bold box");
  hasGlyphs(ascii(box({ strokeStyle: "double" })), ["╔", "╗", "╚", "╝", "═", "║"], "double box");
  hasGlyphs(ascii(box({ rounded: true })), ["╭", "╮", "╰", "╯"], "rounded box");

  const crossing = ascii({
    canvas: { width: 240, height: 200 },
    shapes: [
      { type: "arrow", from: [24, 96], to: [216, 96], color: "dark" },
      { type: "arrow", from: [120, 24], to: [120, 176], color: "red" }
    ]
  });
  hasGlyphs(crossing, ["┼", "▶", "▼"], "crossing arrows");

  // A line is an arrow with the head suppressed: same stroke, no arrowhead glyph.
  const line = ascii({ canvas: { width: 200, height: 60 }, shapes: [{ type: "arrow", arrowhead: false, from: [16, 24], to: [176, 24], color: "dark" }] });
  hasGlyphs(line, ["─"], "line stroke");
  for (const head of ["▶", "◀", "▲", "▼"]) if (line.includes(head)) throw new Error(`line should not draw an arrowhead (${head}):\n${line}`);

  const dashed = ascii(box({ dashed: true }));
  if (!dashed.includes("─ ─")) throw new Error(`dashed rect did not gap its border:\n${dashed}`);

  // ASCII PNG round-trips the scene (incl. the new strokeStyle field) through metadata.
  const spec: SceneSpec = { canvas: { width: 200, height: 120 }, shapes: [{ type: "rect", x: 20, y: 20, width: 120, height: 60, color: "blue", label: "hi", strokeStyle: "double" }] };
  const pngPath = join(dir, "ascii.png");
  const pngResult = JSON.parse(runCli(["render", "--spec", "-", "--ascii", "--out", pngPath, "--json"], JSON.stringify(spec))) as QuickdrawResult;
  verifyResult(pngResult);
  const meta = normalizeScene(JSON.parse(runCli(["inspect", pngPath, "--json"])));
  const rect = meta.shapes.find((shape) => shape.type === "rect");
  if (!rect || rect.type !== "rect" || rect.strokeStyle !== "double") {
    throw new Error(`ascii PNG metadata lost strokeStyle: ${JSON.stringify(rect)}`);
  }

  const dotPath = join(dir, "graph.dot");
  writeFileSync(dotPath, "digraph { A -> B }");
  await expectCliRejects(["render", "--dot", dotPath, "--ascii", "--out", join(dir, "x.png")], "--ascii requires --spec");
}

async function main() {
  await smokeCliRenderInspect();
  await smokeAsciiRender();

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const blankResult = await drawAndSave(browser, { kind: "blank" });
    const clipPath = readClipboardImage();
    if (!clipPath || !existsSync(clipPath)) throw new Error("clipboard image copy was not readable");

    const editResult = await drawAndSave(browser, { kind: "edit", path: blankResult.path });
    console.error("STEP textEditor"); const textResult = await smokeTextEditor(browser);
    console.error("STEP saveActiveText"); const activeTextResult = await smokeSaveActiveText(browser);
    console.error("STEP selectionTools"); const selectionResult = await smokeSelectionTools(browser);
    console.error("STEP multiSelect"); const multiSelectResult = await smokeMultiSelectDelete(browser);
    console.error("STEP preciseLineHit"); const preciseLineHitResult = await smokePreciseLineHit(browser);
    console.error("STEP zOrder"); const zOrderResult = await smokeZOrder(browser);
    console.error("STEP arrowEndpoint"); const arrowEndpointResult = await smokeArrowEndpointEditor(browser);
    console.error("STEP arrowBinding"); const arrowBindingResult = await smokeArrowBinding(browser);
    const gridDrawResult = await smokeGridDraw(browser);
    const gridEditResult = await smokeGridEdit(browser);
    const gridTextResult = await smokeGridText(browser);
    await smokeGridCopyAscii(browser);
    console.error("STEP rotatedTextEdit"); const rotatedTextResult = await smokeRotatedTextEdit(browser);
    const rotatedParityResult = await smokeRotatedTextParity(browser);
    const wrappedTextResult = await smokeWrappedText(browser);
    const imageDeselectResult = await smokeImageBackedDeselect(browser, blankResult.path);
    const spec: SceneSpec = {
      canvas: { width: 640, height: 360 },
      shapes: [
        { type: "rect", x: 50, y: 72, width: 160, height: 84, color: "green", label: "Loaded" },
        { type: "text", x: 240, y: 104, text: "scene", color: "dark" }
      ]
    };
    const sceneResult = await drawAndSave(browser, { kind: "blank", scene: normalizeScene(spec) });
    verifySceneMetadata(sceneResult.path, spec, 1);
    const specPath = join(mkdtempSync(join(tmpdir(), "quickdraw-spec-")), "scene.json");
    const cliOpenSpec: SceneSpec = { shapes: [{ type: "text", x: 220, y: 32, text: "cli-open WWWWWW", color: "dark", fontSize: 19, fontFamily: "Arial", textAlign: "center" }] };
    writeFileSync(specPath, JSON.stringify(cliOpenSpec));
    const cliOpenResult = await drawAndSaveViaCli(browser, ["open", "--spec", specPath], { expectedSourceKind: "blank" });
    verifySceneMetadata(cliOpenResult.path, cliOpenSpec, 0, { width: cliOpenResult.width, height: cliOpenResult.height });
    const cliEditResult = await drawAndSaveViaCli(browser, ["edit", blankResult.path, "--spec", specPath], { expectedSourceKind: "image" });
    if (cliEditResult.width !== blankResult.width || cliEditResult.height !== blankResult.height) {
      throw new Error(`edit --spec changed image dimensions: ${cliEditResult.width}x${cliEditResult.height}`);
    }
    verifySceneMetadata(cliEditResult.path, cliOpenSpec, 0, { width: blankResult.width, height: blankResult.height });
    const inspectedPath = join(mkdtempSync(join(tmpdir(), "quickdraw-inspect-")), "scene.json");
    writeFileSync(inspectedPath, runCli(["inspect", cliEditResult.path, "--json"]));
    const reopenedResult = await drawAndSaveViaCli(browser, ["open", "--spec", inspectedPath, cliEditResult.path], { expectedSourceKind: "image" });
    verifySceneMetadata(reopenedResult.path, cliOpenSpec, 0, { width: cliEditResult.width, height: cliEditResult.height });

    console.log(JSON.stringify({ blank: blankResult, clipboardPath: clipPath, edit: editResult, text: textResult, activeText: activeTextResult, selection: selectionResult, multiSelect: multiSelectResult, preciseLineHit: preciseLineHitResult, zOrder: zOrderResult, arrowEndpoint: arrowEndpointResult, arrowBinding: arrowBindingResult, gridDraw: gridDrawResult, gridEdit: gridEditResult, gridText: gridTextResult, rotatedText: rotatedTextResult, rotatedParity: rotatedParityResult, wrappedText: wrappedTextResult, imageDeselect: imageDeselectResult, scene: sceneResult, cliOpen: cliOpenResult, cliEdit: cliEditResult, reopened: reopenedResult }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
