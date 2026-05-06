---
name: cldraw
description: Open a lightweight local drawing surface to create, annotate, or recover PNG images for agent workflows.
license: MIT
compatibility: macOS with Bun; browser access; clipboard and screenshot features use AppleScript/screencapture.
allowed-tools: Bash Read
metadata:
  command: cldraw
  outputs: PNG path token
---

# cldraw

Use this skill when the user wants to draw a quick diagram, annotate an image or screenshot, recover an image from the clipboard into a file, or produce an `@/tmp/...png` path that can be pasted into an agent chat.

## What It Does

`cldraw` starts a temporary local Vite drawing app, opens it in the browser, waits for the user to finish, writes a PNG under `/tmp`, copies that PNG image to the macOS clipboard, and prints the result as an agent-friendly path token:

```text
@/tmp/cldraw-xxxxxxxx.png
```

The command blocks until the drawing app sends Done or Cancel.

## Commands

```bash
# Blank canvas
cldraw

# Edit an existing image file
cldraw edit /path/to/image.png

# Open the current clipboard PNG for editing
cldraw paste

# Interactively capture a screenshot region/window, then annotate it
cldraw shot

# Print structured result data
cldraw --json
cldraw edit /path/to/image.png --json

# After Done, paste the @/tmp/...png token back into the app that was focused
# before cldraw opened the browser
cldraw --paste
cldraw shot --paste
```

## Agent Workflow

1. Use `cldraw` when a visual answer is faster than prose or when the user asks to draw/mark something up.
2. Tell the user the browser drawing surface opened and that the command is waiting for Done.
3. After the command exits, use the printed `@/tmp/...png` path as the durable artifact path.
4. If the user wants the image inserted into the conversation, render it with Markdown:

```markdown
![cldraw output](/tmp/cldraw-xxxxxxxx.png)
```

5. If the user wants to continue editing, run:

```bash
cldraw edit /tmp/cldraw-xxxxxxxx.png
```

## Recovering An Existing Image

Use these paths depending on where the image lives:

```bash
# Image file already exists
cldraw edit /absolute/path/to/image.png

# Image is on the macOS clipboard
cldraw paste

# Image is visible on screen but not saved
cldraw shot
```

`cldraw paste` requires the clipboard to contain PNG image data. If it fails with `clipboard does not contain a PNG image`, use `cldraw shot` or save the image to disk and run `cldraw edit`.

## Getting cldraw Back

The command shim is:

```bash
~/commands/cldraw
```

It executes the repo source directly:

```bash
bun run /Users/yesh/Documents/personal/cldraw/src/cli.ts "$@"
```

To restore it if the shim disappears:

```bash
cat > ~/commands/cldraw <<'EOF'
#!/usr/bin/env zsh
set -euo pipefail

exec bun run /Users/yesh/Documents/personal/cldraw/src/cli.ts "$@"
EOF
chmod +x ~/commands/cldraw
```

To restore dependencies if the repo is present but broken:

```bash
cd /Users/yesh/Documents/personal/cldraw
bun install
bun run typecheck
```

## Verification

```bash
command -v cldraw
cldraw --json
cldraw edit /path/to/image.png --json
cd /Users/yesh/Documents/personal/cldraw && bun run typecheck
```

Do not claim a drawing was produced unless the command exits and prints a path or JSON result.

## Failure Modes

- `fatal: not a git repository`: current `cldraw` checkout has no `.git`; do not infer commit history from this directory.
- `clipboard does not contain a PNG image`: clipboard has text, HTML, or a non-PNG image representation; use `cldraw shot` or `cldraw edit`.
- `screenshot cancelled`: user cancelled macOS screenshot selection.
- Browser opens but command keeps waiting: press Done or Cancel in the drawing app.
- Clipboard copy can fail silently in non-macOS or permission-constrained contexts; the output path is still the source of truth.
