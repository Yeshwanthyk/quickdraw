# quick-paint

A tiny screenshot/image annotator that opens fast, lets you draw, then writes a PNG and copies it to the clipboard.

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

## Use

```bash
quick-paint                         # blank canvas
quick-paint edit image.png          # annotate an image
quick-paint paste                   # annotate clipboard PNG
quick-paint shot                    # take a macOS screenshot, then annotate
quick-paint --json                  # machine-readable result
quick-paint shot --paste            # paste @/tmp/...png token back to focused app
```

Output is a PNG under `/tmp/quick-paint-xxxxxxxx.png`. The image is also copied to the macOS clipboard when possible.

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

Selection mode supports click-to-select, drag-to-move, and `Delete`/`Backspace` to remove the selected item.

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
