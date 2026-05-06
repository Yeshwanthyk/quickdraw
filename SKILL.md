---
name: cldraw
description: Run cldraw directly when the user wants to create, annotate, recover, or paste PNG drawings and screenshots.
license: MIT
compatibility: macOS; browser access; clipboard and screenshot modes use AppleScript/screencapture.
allowed-tools: Bash Read
metadata:
  command: cldraw
  output: "@/tmp/cldraw-*.png"
---

# cldraw

Use when a quick drawing, screenshot markup, clipboard-image recovery, or `@/tmp/...png` image token is better than prose. Use the installed `cldraw` command from the current environment; do not inspect the source repo first unless the command fails.

## Contract

`cldraw` opens a temporary browser drawing surface, blocks until Save/Cancel, writes a PNG under `/tmp`, copies the PNG to the macOS clipboard, and prints `@/tmp/cldraw-*.png`.

## Commands

```bash
cldraw
cldraw edit /path/to/image.png
cldraw paste
cldraw shot
cldraw --json
cldraw shot --paste
```

Modes:
- `blank`: no args; draw on a white canvas.
- `edit`: annotate an existing image file.
- `paste`: recover/edit the current clipboard PNG.
- `shot`: select a macOS screenshot region/window, then annotate it.
- `--json`: print `{ path, mime, width, height, clipboard }`.
- `--paste`: after Save, paste the `@/tmp/...png` token back into the app that was focused before launch.

## Workflow

1. Run the smallest command for the source: `cldraw`, `cldraw edit <file>`, `cldraw paste`, or `cldraw shot`.
2. Tell the user the browser is open and the command is waiting for Save.
3. Use the printed `@/tmp/...png` as the durable artifact.
4. To show it in Codex, render:

```markdown
![cldraw output](/tmp/cldraw-xxxxxxxx.png)
```

To continue editing:

```bash
cldraw edit /tmp/cldraw-xxxxxxxx.png
```

## Restore

Command source:
- Prefer `cldraw` from `PATH`.
- In Yesh's environment, gitgud/dotfile sync installs it under `~/commands/cldraw`.
- The command is a self-extracting executable with its app payload; it should not depend on `/Users/yesh/Documents/personal/cldraw`.

If rebuilding locally from the source checkout:

```bash
cd /Users/yesh/Documents/personal/cldraw
bun install
bun run build:command
```

Do not replace it with a repo-path launcher or `bun build --compile`; both are less portable for this Vite-based tool.

## Verification

```bash
command -v cldraw
cd /Users/yesh/Documents/personal/cldraw && bun run typecheck
```

Do not claim an image exists until `cldraw` exits and prints a path or JSON result.
