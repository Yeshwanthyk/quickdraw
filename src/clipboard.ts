import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runOsascript(script: string[]) {
  const proc = Bun.spawnSync(["osascript", ...script.flatMap((line) => ["-e", line])], {
    stdout: "pipe",
    stderr: "pipe"
  });
  if (!proc.success) {
    throw new Error(proc.stderr.toString().trim() || "osascript failed");
  }
  return proc.stdout.toString().trim();
}

function ensureMacOS(operation: string) {
  if (process.platform !== "darwin") {
    throw new Error(`${operation} is only implemented on macOS`);
  }
}

export function copyImageToClipboard(path: string): boolean {
  ensureMacOS("clipboard image copy");
  runOsascript([
    `set the clipboard to (read (POSIX file "${path}") as «class PNGf»)`
  ]);
  return true;
}

export function readClipboardImage(): string | null {
  ensureMacOS("clipboard image paste");
  const path = join(mkdtempSync(join(tmpdir(), "quickdraw-clipboard-")), "clipboard.png");
  const proc = Bun.spawnSync([
    "osascript",
    "-e",
    "set pngData to the clipboard as «class PNGf»",
    "-e",
    `set outFile to open for access POSIX file "${path}" with write permission`,
    "-e",
    "set eof outFile to 0",
    "-e",
    "write pngData to outFile",
    "-e",
    "close access outFile"
  ], { stdout: "pipe", stderr: "pipe" });
  if (!proc.success) return null;
  return path;
}
