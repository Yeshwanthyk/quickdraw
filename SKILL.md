---
name: quickdraw
description: Run quickdraw directly when the user wants to create, annotate, recover, or paste PNG drawings and screenshots.
license: MIT
compatibility: macOS; browser access; clipboard and screenshot modes use AppleScript/screencapture.
allowed-tools: Bash Read
metadata:
  command: quickdraw
  output: "@/tmp/quickdraw-*.png"
---

# quickdraw

Use when a quick drawing, screenshot markup, clipboard-image recovery, or `@/tmp/...png` image token is better than prose. Prefer the AI-first `render` command when the image can be described as shapes; open the browser only when human refinement is faster.

## Contract

`quickdraw render` writes a PNG directly from a JSON scene spec without opening a browser. Browser modes open a temporary drawing surface, block until Save/Cancel, write a PNG under `/tmp`, copy the PNG to the macOS clipboard, and print `@/tmp/quickdraw-*.png`.

## Commands

```bash
quickdraw render --spec scene.json --out /tmp/diagram.png
echo '{"shapes":[...]}' | quickdraw render --spec - --out /tmp/diagram.png --json
echo '{"shapes":[...]}' | quickdraw render --spec - --ascii            # box-drawing text to stdout
quickdraw render --spec scene.json --ascii --out /tmp/diagram.txt      # or a monospace .png
echo 'graph LR; A-->B' | quickdraw render --mermaid - --out /tmp/flow.png --json
echo 'digraph { A -> B }' | quickdraw render --dot - --out /tmp/graph.png --json
quickdraw inspect /tmp/diagram.png --json
quickdraw open --spec scene.json
quickdraw open --spec scene.json /path/to/screenshot.png
quickdraw
quickdraw edit /path/to/image.png
quickdraw paste
quickdraw shot
quickdraw --json
quickdraw shot --context markdown
quickdraw shot --context json
quickdraw shot --context codex --paste
quickdraw shot --paste
```

Modes:
- `render`: headless AI-first path. Reads a scene spec and writes a PNG without browser interaction.
- `render --ascii`: render the scene as a MonoSketch-style box-drawing diagram. Prints text to stdout (or `--out file.txt`), or a monospace `--out file.png`. Requires `--spec`.
- `render --mermaid` / `render --dot`: adapter path for simple graph source. Uses installed renderers first and `bunx` fallbacks when needed.
- `inspect`: extracts the embedded quickdraw scene from a PNG for round-trip edits or diffing.
- `open`: opens a browser canvas preloaded with an optional scene spec and optional image.
- `blank`: no args; draw on a white canvas.
- `edit`: annotate an existing image file.
- `paste`: recover/edit the current clipboard PNG.
- `shot`: select a macOS screenshot region/window, then annotate it.
- `--json`: print the legacy result `{ path, mime, width, height, clipboard, sha256, token, markdown, inspect }`.
- `--context token|markdown|json|codex`: print the handoff string an agent should inject after Save. `token` is default; `markdown`/`codex` print `![quickdraw output](/tmp/...)`; `json` prints the full recoverable context envelope.
- `--paste`: after Save, paste the selected context output back into the app that was focused before launch.

## Decision Tree

- Use `render` for diagrams, callouts, labels, redactions, arrows, and other images an agent can specify deterministically.
- Use `render --ascii` when you want a copy-pasteable text diagram (box-drawing characters) instead of, or alongside, a PNG — e.g. to drop into a comment, README, or chat.
- Use `render --mermaid` or `render --dot` when the source already exists as graph text.
- Use `open --spec` when a generated scene needs hand adjustment before saving.
- Use `shot` for screenshot markup.
- Use `paste` for a clipboard image.
- Use `inspect` before editing an existing quickdraw PNG so you can reuse its scene instead of redrawing from pixels.
- Do not use quickdraw for charts, data visualization, photo editing, or complex illustration.

## Scene Spec

```json
{
  "canvas": { "width": 800, "height": 500 },
  "shapes": [
    { "type": "rect", "x": 40, "y": 160, "width": 200, "height": 80, "color": "blue", "label": "Login Form" },
    { "type": "arrow", "from": [240, 200], "to": [300, 200], "color": "red", "label": "submit" },
    { "type": "text", "x": 40, "y": 280, "width": 180, "text": "Step 1", "color": "dark", "fontSize": 16 },
    { "type": "highlight", "points": [36, 304, 190, 304], "color": "yellow" }
  ]
}
```

Supported shape types:
- `rect`: `x`, `y`, `width`, `height`, optional `fill`, optional `label`.
- `redact`: same as `rect`, rendered as a solid dark block.
- `arrow`: `from: [x, y]` and `to: [x, y]`, or `points: [x1, y1, x2, y2]`, optional `label`. Optional `startBinding`/`endBinding` (`{ "shapeId", "ratio": [0..1, 0..1] }`) glue an endpoint to a shape so it re-routes when that shape moves.
- `text`: `x`, `y`, `text`, optional `width`, `lineHeight`, `fontSize`, `fontFamily`, `textAlign`. Add `width` when text should wrap predictably.
- `pen`, `highlight`, `highlighter`: `points: [x1, y1, x2, y2, ...]`.

Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `dark`, `black`, `white`.

ASCII styling (only affects `--ascii` output; ignored by the pixel/PNG paths): `rect` and `arrow` accept `strokeStyle: "single" | "bold" | "double"` and `dashed: true`; `rect` also accepts `rounded: true`. Line overlaps resolve to box-drawing junctions (`├ ┼ ┤ ┬ ┴`).

## Workflow

1. For agent-authored images, write a small scene JSON and run `quickdraw render --spec scene.json --out /tmp/name.png --context json`.
2. For hand editing, run the smallest browser command for the source: `quickdraw open --spec <scene>`, `quickdraw edit <file>`, `quickdraw paste`, or `quickdraw shot`.
3. If the browser opens, tell the user the command is waiting for Save.
4. Use the printed context to inject the durable artifact:
   - Codex/chat display: use `--context codex` or render the returned `markdown`.
   - Tool/native attachment flow: use `token`.
   - Programmatic recovery: use `--context json` and preserve `scene`/`inspect`.
5. To show it in Codex, render:

```markdown
![quickdraw output](/tmp/quickdraw-xxxxxxxx.png)
```

To continue editing:

```bash
quickdraw inspect /tmp/quickdraw-xxxxxxxx.png --json > /tmp/scene.json
quickdraw open --spec /tmp/scene.json
```

For adapter PNGs, `inspect` returns `{ "adapter": "...", "source": "..." }`; edit the source text and re-run `render --mermaid` or `render --dot` instead of passing that JSON to `open --spec`.

Browser selection supports z-order buttons, resize/rotation handles, arrow-key nudging, and arrow endpoint handles.

## Restore

Command source:
- Prefer `quickdraw` from `PATH`.
- Dotfile/gitgud sync can install it under `~/commands/quickdraw`.
- The command is a self-extracting executable with its app payload; it should not depend on a source checkout.

If rebuilding locally from the source checkout:

```bash
cd /path/to/quickdraw
bun install
bun run build:command
```

Do not replace it with a repo-path launcher or `bun build --compile`; both are less portable for this Vite-based tool.

## Verification

```bash
command -v quickdraw
quickdraw --help
```

Do not claim an image exists until `quickdraw` exits and prints a path or JSON result.
