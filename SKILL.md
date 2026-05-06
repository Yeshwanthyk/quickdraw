---
name: cldraw
description: Use the local cldraw command to create, annotate, recover, or paste PNG drawings and screenshots for agent workflows.
license: MIT
compatibility: macOS; browser access; clipboard and screenshot modes use AppleScript/screencapture.
allowed-tools: Bash Read
metadata:
  command: cldraw
  output: "@/tmp/cldraw-*.png"
---

# cldraw

Use when a quick drawing, screenshot markup, clipboard-image recovery, or `@/tmp/...png` image token is better than prose.

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

Executable:

```bash
~/commands/cldraw
```

If missing, rebuild from source:

```bash
cd /Users/yesh/Documents/personal/cldraw
bun install
bun build --compile --target=bun --external vite --compile-autoload-package-json --compile-autoload-tsconfig --outfile ~/commands/cldraw src/cli.ts
chmod +x ~/commands/cldraw
```

Fallback source launcher:

```bash
exec bun run /Users/yesh/Documents/personal/cldraw/src/cli.ts "$@"
```

## Verification

```bash
command -v cldraw
cd /Users/yesh/Documents/personal/cldraw && bun run typecheck
```

Do not claim an image exists until `cldraw` exits and prints a path or JSON result.
