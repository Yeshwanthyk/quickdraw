import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function captureScreenshot(): string {
  if (process.platform !== "darwin") {
    throw new Error("screenshot capture is only implemented on macOS");
  }
  const path = join(mkdtempSync(join(tmpdir(), "quickdraw-shot-")), "shot.png");
  const proc = Bun.spawnSync(["screencapture", "-i", "-x", path], {
    stdout: "pipe",
    stderr: "pipe"
  });
  if (!proc.success) throw new Error(proc.stderr.toString().trim() || "screenshot cancelled");
  return path;
}
