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

Use when a quick drawing, screenshot markup, clipboard-image recovery, or `@/tmp/...png` image token is better than prose. Prefer the AI-first `render` command when the image can be described as shapes; open the browser only when human refinement is faster.

## Contract

`quick-paint render` writes a PNG directly from a JSON scene spec without opening a browser. Browser modes open a temporary drawing surface, block until Save/Cancel, write a PNG under `/tmp`, copy the PNG to the macOS clipboard, and print `@/tmp/quick-paint-*.png`.

## Commands

```bash
quick-paint render --spec scene.json --out /tmp/diagram.png
echo '{"shapes":[...]}' | quick-paint render --spec - --out /tmp/diagram.png --json
echo 'graph LR; A-->B' | quick-paint render --mermaid - --out /tmp/flow.png --json
echo 'digraph { A -> B }' | quick-paint render --dot - --out /tmp/graph.png --json
quick-paint inspect /tmp/diagram.png --json
quick-paint open --spec scene.json
quick-paint open --spec scene.json /path/to/screenshot.png
quick-paint
quick-paint edit /path/to/image.png
quick-paint paste
quick-paint shot
quick-paint --json
quick-paint shot --paste
```

Modes:
- `render`: headless AI-first path. Reads a scene spec and writes a PNG without browser interaction.
- `render --mermaid` / `render --dot`: adapter path for simple graph source. Uses installed renderers first and `bunx` fallbacks when needed.
- `inspect`: extracts the embedded quick-paint scene from a PNG for round-trip edits or diffing.
- `open`: opens a browser canvas preloaded with an optional scene spec and optional image.
- `blank`: no args; draw on a white canvas.
- `edit`: annotate an existing image file.
- `paste`: recover/edit the current clipboard PNG.
- `shot`: select a macOS screenshot region/window, then annotate it.
- `--json`: print `{ path, mime, width, height, clipboard }`.
- `--paste`: after Save, paste the `@/tmp/...png` token back into the app that was focused before launch.

## Decision Tree

- Use `render` for diagrams, callouts, labels, redactions, arrows, and other images an agent can specify deterministically.
- Use `render --mermaid` or `render --dot` when the source already exists as graph text.
- Use `open --spec` when a generated scene needs hand adjustment before saving.
- Use `shot` for screenshot markup.
- Use `paste` for a clipboard image.
- Use `inspect` before editing an existing quick-paint PNG so you can reuse its scene instead of redrawing from pixels.
- Do not use quick-paint for charts, data visualization, photo editing, or complex illustration.

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
- `arrow`: `from: [x, y]` and `to: [x, y]`, or `points: [x1, y1, x2, y2]`, optional `label`.
- `text`: `x`, `y`, `text`, optional `width`, `lineHeight`, `fontSize`, `fontFamily`, `textAlign`. Add `width` when text should wrap predictably.
- `pen`, `highlight`, `highlighter`: `points: [x1, y1, x2, y2, ...]`.

Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `dark`, `black`, `white`.

## Workflow

1. For agent-authored images, write a small scene JSON and run `quick-paint render --spec scene.json --out /tmp/name.png --json`.
2. For hand editing, run the smallest browser command for the source: `quick-paint open --spec <scene>`, `quick-paint edit <file>`, `quick-paint paste`, or `quick-paint shot`.
3. If the browser opens, tell the user the command is waiting for Save.
4. Use the printed `@/tmp/...png` as the durable artifact.
5. To show it in Codex, render:

```markdown
![quick-paint output](/tmp/quick-paint-xxxxxxxx.png)
```

To continue editing:

```bash
quick-paint inspect /tmp/quick-paint-xxxxxxxx.png --json > /tmp/scene.json
quick-paint open --spec /tmp/scene.json
```

For adapter PNGs, `inspect` returns `{ "adapter": "...", "source": "..." }`; edit the source text and re-run `render --mermaid` or `render --dot` instead of passing that JSON to `open --spec`.

Browser selection supports z-order buttons, resize/rotation handles, arrow-key nudging, and arrow endpoint handles.

## Restore

Command source:
- Prefer `quick-paint` from `PATH`.
- Dotfile/gitgud sync can install it under `~/commands/quick-paint`.
- The command is a self-extracting executable with its app payload; it should not depend on a source checkout.

If rebuilding locally from the source checkout:

```bash
cd /path/to/quick-paint
bun install
bun run build:command
```

Do not replace it with a repo-path launcher or `bun build --compile`; both are less portable for this Vite-based tool.

## Verification

```bash
command -v quick-paint
quick-paint --help
```

Do not claim an image exists until `quick-paint` exits and prints a path or JSON result.
