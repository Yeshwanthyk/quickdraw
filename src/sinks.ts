export function focusedAppBundleId(): string | null {
  if (process.platform !== "darwin") return null;
  const proc = Bun.spawnSync([
    "osascript",
    "-e",
    "tell application \"System Events\" to get bundle identifier of first application process whose frontmost is true"
  ], { stdout: "pipe", stderr: "pipe" });
  if (!proc.success) return null;
  return proc.stdout.toString().trim() || null;
}

export function pasteTextIntoFocusedApp(text: string) {
  if (process.platform !== "darwin") {
    throw new Error("--paste is only implemented on macOS");
  }
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const proc = Bun.spawnSync([
    "osascript",
    "-e",
    `set the clipboard to "${escaped}"`,
    "-e",
    "tell application \"System Events\" to keystroke \"v\" using command down"
  ], { stdout: "pipe", stderr: "pipe" });
  if (!proc.success) {
    throw new Error(proc.stderr.toString().trim() || "paste failed");
  }
}

export function pasteTextIntoApp(text: string, bundleId: string | null) {
  if (bundleId) {
    const activate = Bun.spawnSync([
      "osascript",
      "-e",
      `tell application id "${bundleId}" to activate`
    ], { stdout: "pipe", stderr: "pipe" });
    if (!activate.success) throw new Error(activate.stderr.toString().trim() || "activate failed");
  }
  pasteTextIntoFocusedApp(text);
}
