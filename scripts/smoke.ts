import { existsSync, statSync } from "node:fs";
import { chromium } from "@playwright/test";
import { readClipboardImage } from "../src/clipboard";
import { startQuickPaintServer, type QuickPaintResult } from "../src/server";

function verifyResult(result: QuickPaintResult) {
  if (!existsSync(result.path)) throw new Error(`missing output: ${result.path}`);
  if (statSync(result.path).size < 100) throw new Error(`empty output: ${result.path}`);
  if (result.mime !== "image/png") throw new Error(`unexpected mime: ${result.mime}`);
  if (result.width <= 0 || result.height <= 0) throw new Error(`bad dimensions: ${result.width}x${result.height}`);
}

async function drawAndSave(browser: Awaited<ReturnType<typeof chromium.launch>>, mode: Parameters<typeof startQuickPaintServer>[0]) {
  const session = await startQuickPaintServer(mode, { open: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Pen" }).click();
    await page.mouse.move(140, 120);
    await page.mouse.down();
    await page.mouse.move(260, 210);
    await page.mouse.move(340, 145);
    await page.mouse.up();
    await page.getByRole("button", { name: "Save" }).click();

    const result = await session.result;
    verifyResult(result);
    await page.close();
    return result;
  } finally {
    session.stop();
  }
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const blankResult = await drawAndSave(browser, { kind: "blank" });
    const clipPath = readClipboardImage();
    if (!clipPath || !existsSync(clipPath)) throw new Error("clipboard image copy was not readable");

    const editResult = await drawAndSave(browser, { kind: "edit", path: blankResult.path });
    console.log(JSON.stringify({ blank: blankResult, clipboardPath: clipPath, edit: editResult }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
