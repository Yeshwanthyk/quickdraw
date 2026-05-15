# quick-paint

A tiny AI-first PNG tool: render simple scene specs headlessly, or open a fast browser canvas for screenshot/image annotation.

## Install

Download the `quick-paint` executable from the latest GitHub Release, then put it somewhere on your `PATH`:

```bash
mkdir -p ~/.local/bin
curl -L -o ~/.local/bin/quick-paint \
  https://github.com/<owner>/quick-paint/releases/latest/download/quick-paint
chmod +x ~/.local/bin/quick-paint
quick-paint --help
```

On macOS, if Gatekeeper marks the downloaded file as quarantined:

```bash
xattr -d com.apple.quarantine ~/.local/bin/quick-paint
```

If you use `~/commands` instead:

```bash
mkdir -p ~/commands
curl -L -o ~/commands/quick-paint \
  https://github.com/<owner>/quick-paint/releases/latest/download/quick-paint
chmod +x ~/commands/quick-paint
```

Replace `<owner>` with the GitHub owner after the repository is published. The release asset to upload is `dist/quick-paint`.

## Install the agent skill

This repo includes `SKILL.md` for Claude, Codex, Pi, and other agents that support filesystem skills. After installing the `quick-paint` command, tell your agent:

> Install the quick-paint skill from this repo's `SKILL.md` into my agent skills directory as `quick-paint`.

Manual install examples:

```bash
# Claude Code
mkdir -p ~/.claude/skills/quick-paint
cp SKILL.md ~/.claude/skills/quick-paint/SKILL.md

# Codex
mkdir -p ~/.codex/skills/quick-paint
cp SKILL.md ~/.codex/skills/quick-paint/SKILL.md

# Pi
mkdir -p ~/.pi/agent/skills/quick-paint
cp SKILL.md ~/.pi/agent/skills/quick-paint/SKILL.md
```

If you sync skills through a dotfiles/gitgud directory, copy it there instead and symlink agent-specific skill folders to it:

```bash
mkdir -p ~/.gitgud/skills/quick-paint
cp SKILL.md ~/.gitgud/skills/quick-paint/SKILL.md
ln -sfn ~/.gitgud/skills/quick-paint ~/.claude/skills/quick-paint
ln -sfn ~/.gitgud/skills/quick-paint ~/.codex/skills/quick-paint
ln -sfn ~/.gitgud/skills/quick-paint ~/.pi/agent/skills/quick-paint
```

## Use

```bash
quick-paint render --spec scene.json --out /tmp/diagram.png
echo '{"shapes":[...]}' | quick-paint render --spec - --out /tmp/diagram.png --json
echo 'graph LR; A-->B' | quick-paint render --mermaid - --out /tmp/flow.png --json
echo 'digraph { A -> B }' | quick-paint render --dot - --out /tmp/graph.png --json
quick-paint inspect /tmp/diagram.png --json
quick-paint open --spec scene.json image.png
quick-paint                         # blank canvas
quick-paint edit image.png          # annotate an image
quick-paint paste                   # annotate clipboard PNG
quick-paint shot                    # take a macOS screenshot, then annotate
quick-paint --json                  # machine-readable result
quick-paint shot --paste            # paste @/tmp/...png token back to focused app
```

Browser output is a PNG under `/tmp/quick-paint-xxxxxxxx.png`. Rendered output goes to `--out`. The image is also copied to the macOS clipboard when possible.

Minimal scene spec:

```json
{
  "canvas": { "width": 800, "height": 500 },
  "shapes": [
    { "type": "rect", "x": 40, "y": 160, "width": 200, "height": 80, "color": "blue", "label": "Login Form" },
    { "type": "arrow", "from": [240, 200], "to": [300, 200], "color": "red", "label": "submit" },
    { "type": "text", "x": 40, "y": 280, "width": 180, "text": "Step 1", "color": "dark", "fontSize": 16 }
  ]
}
```

Supported shapes: `rect`, `redact`, `arrow`, `text`, `pen`, `highlight`. Text supports optional `width`, `lineHeight`, `fontSize`, `fontFamily`, and `textAlign`; fixed-width text wraps. Named colors: `red`, `orange`, `yellow`, `green`, `blue`, `dark`, `black`, `white`.

Adapter renders:
- `--mermaid` uses `mmdc` when installed, otherwise `bunx @mermaid-js/mermaid-cli`.
- `--dot` uses Graphviz `dot` when installed, otherwise `bunx @hpcc-js/wasm-graphviz-cli`.
- `inspect` returns adapter/source metadata for adapter PNGs; edit that source and rerender rather than passing it to `open --spec`.

## Drawing shortcuts

| Key | Tool |
| --- | --- |
| `1` | Select |
| `2` | Pen |
| `3` | Highlighter |
| `4` | Arrow |
| `5` | Rectangle |
| `6` | Text |
| `7` | Redact |

Selection mode supports click-to-select, Shift-click multi-select, drag-to-move, arrow-key nudging, resize/rotation handles, z-order buttons, and `Delete`/`Backspace`. Selected arrows expose endpoint handles instead of generic resize handles.

## Build a release executable

The release executable is a self-extracting zsh script containing the Vite app payload and `node_modules`. It requires Bun on the target machine.

```bash
bun install
scripts/build-command.sh dist/quick-paint
shasum -a 256 dist/quick-paint > dist/quick-paint.sha256
```

Verify the artifact:

```bash
dist/quick-paint --help
bun run smoke
```

Upload both files to the GitHub Release for the current tag.

## Development

```bash
bun install
bun run typecheck
bun run smoke
bun run dev
```

## Requirements

- macOS for clipboard, screenshot, and paste-back modes.
- Bun installed on machines running the downloadable executable.
- A browser available for the drawing UI.
