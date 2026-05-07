---
name: quick-paint
description: Run quick-paint directly when the user wants to create, annotate, recover, or paste PNG drawings and screenshots.
license: MIT
compatibility: macOS; browser access; clipboard and screenshot modes use AppleScript/screencapture.
allowed-tools: Bash Read
metadata:
  command: quick-paint
  output: "@/tmp/quick-paint-*.png"
---

# quick-paint

Use when a quick drawing, screenshot markup, clipboard-image recovery, or `@/tmp/...png` image token is better than prose. Use the installed `quick-paint` command from the current environment; do not inspect the source repo first unless the command fails.

## Contract

`quick-paint` opens a temporary browser drawing surface, blocks until Save/Cancel, writes a PNG under `/tmp`, copies the PNG to the macOS clipboard, and prints `@/tmp/quick-paint-*.png`.

## Commands

```bash
quick-paint
quick-paint edit /path/to/image.png
quick-paint paste
quick-paint shot
quick-paint --json
quick-paint shot --paste
```

Modes:
- `blank`: no args; draw on a white canvas.
- `edit`: annotate an existing image file.
- `paste`: recover/edit the current clipboard PNG.
- `shot`: select a macOS screenshot region/window, then annotate it.
- `--json`: print `{ path, mime, width, height, clipboard }`.
- `--paste`: after Save, paste the `@/tmp/...png` token back into the app that was focused before launch.

## Workflow

1. Run the smallest command for the source: `quick-paint`, `quick-paint edit <file>`, `quick-paint paste`, or `quick-paint shot`.
2. Tell the user the browser is open and the command is waiting for Save.
3. Use the printed `@/tmp/...png` as the durable artifact.
4. To show it in Codex, render:

```markdown
![quick-paint output](/tmp/quick-paint-xxxxxxxx.png)
```

To continue editing:

```bash
quick-paint edit /tmp/quick-paint-xxxxxxxx.png
```

## Restore

Command source:
- Prefer `quick-paint` from `PATH`.
- In Yesh's environment, gitgud/dotfile sync installs it under `~/commands/quick-paint`.
- The command is a self-extracting executable with its app payload; it should not depend on `/Users/yesh/Documents/personal/quick-paint`.

If rebuilding locally from the source checkout:

```bash
cd /Users/yesh/Documents/personal/quick-paint
bun install
bun run build:command
```

Do not replace it with a repo-path launcher or `bun build --compile`; both are less portable for this Vite-based tool.

## Verification

```bash
command -v quick-paint
cd /Users/yesh/Documents/personal/quick-paint && bun run typecheck
```

Do not claim an image exists until `quick-paint` exits and prints a path or JSON result.
