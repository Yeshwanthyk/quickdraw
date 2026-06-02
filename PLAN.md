# quickdraw → AI-first + Excalidraw-grade Analysis

## Current state diagnosis

**Files:** `web/App.tsx` (367 lines, all rendering + all event logic), `web/tools/types.ts` (4 shape types), `src/cli.ts`, `src/server.ts`.

**Where it's weakest:**
- **Text:** `window.prompt("Text")` at `web/App.tsx:103-110`. No edit-after-creation, no font choice, no wrapping, no caret control.
- **Selection:** dashed box only. No resize handles, no rotation, no multi-select, no nudge, no aspect-lock.
- **Arrows:** straight line, no shape-binding, no midpoint editing, no labels.
- **Render:** single Konva stage re-renders everything on every pointer move.
- **AI surface:** CLI requires browser + human Save. No headless render, no scene spec, PNG carries no metadata, SKILL.md only documents human-interactive modes.

---

## 1. Text editing — adopt Excalidraw's WYSIWYG textarea trick

The trick: a real `<textarea>` is created in DOM, styled transparent, absolutely positioned over the canvas, and CSS-transformed to match scale/rotation. On `blur`/`Enter` it commits to a canvas-rendered text shape.

**Minimum files to port (in priority order):**

| Source file | What we steal | LOC est. |
|---|---|---|
| `/tmp/excalidraw/packages/excalidraw/wysiwyg/textWysiwyg.tsx` | Imperative textarea factory, `updateWysiwygStyle`, `getTransform` | ~400 |
| `/tmp/excalidraw/packages/element/src/textMeasurements.ts` | `getLineWidth`, `measureText`, `getLineHeightInPx` (offscreen-canvas `measureText` + char-width cache) | ~80 |
| `/tmp/excalidraw/packages/element/src/textWrapping.ts` | `wrapText`, Unicode-aware `parseTokens` for CJK/emoji | ~200 |
| `/tmp/excalidraw/packages/element/src/renderElement.ts:547-600` | Multi-line `fillText` loop with vertical offset from `hhea` metrics | ~50 |
| `/tmp/excalidraw/packages/common/src/font-metadata.ts` | `getVerticalOffset` per-font baseline correction | ~100 |

**Key entry points to study:**
- `App.tsx:8967` `handleTextOnPointerDown`
- `App.tsx:6183` `startTextEditing`
- `App.tsx:5706` `handleTextWysiwyg`
- `App.tsx:6408` `handleCanvasDoubleClick` (double-click to re-edit)

**Text state fields we need to add to `TextShape`:**
`text`, `originalText` (pre-wrap), `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `lineHeight`, `autoResize`, optional `containerId`.

---

## 2. Shape/interaction model — what to port, prioritized

From `/tmp/excalidraw/packages/element/src/`:

| Rank | File | Win |
|---|---|---|
| 1 | `collision.ts` (`hitElementItself`, lines 119 / 194 / 742 / 756) | Two-tier hit testing (rotated AABB → precise outline). Fixes click-to-select on thin lines + rotated shapes. |
| 2 | `transformHandles.ts` + `resizeTest.ts` (`getTransformHandlesFromCoords` at 133, `resizeTest` at 49) | 8 resize handles + rotation handle. Replaces dashed-outline-only selection. |
| 3 | `resizeElements.ts:722` + `keys.ts:146` | `resizeSingleElement` math with Shift = aspect-lock. |
| 4 | `selection.ts` + `bounds.ts:1008` `getCommonBounds` | Multi-select as `{[id]: true}` map; group-move. |
| 5 | `linearElementEditor.ts:125` | Click an arrow → individual `points[]` selectable. |
| 6 | `binding.ts` + `types.ts:284` `FixedPointBinding` | Arrow endpoints store `[0..1, 0..1]` ratios on target shape → arrows re-route when shapes move. |
| 7 | `App.tsx:5165-5198` + `constants.ts:22-23` | Arrow-key nudge (1px / Shift=5px). 30 lines, immediately professional. |
| 8 | `zindex.ts:566-594` | Bring-to-front / send-to-back. |
| 9 | `snapping.ts:692` `snapDraggedElements` | Object-to-object snap guides. Highest complexity, save for last. |

**Type model upgrade:** unify under a single `_ExcalidrawElementBase`-style base (`id`, `x/y`, `width/height`, `angle: Radians`, `strokeColor`, `backgroundColor`, `strokeWidth`, `opacity`, `version`, `groupIds`, `boundElements`, `locked`). See `/tmp/excalidraw/packages/element/src/types.ts:40`.

---

## 3. Rendering & performance — what to copy

Excalidraw uses **raw Canvas 2D, three separate `<canvas>` elements**, no Konva:

- `StaticCanvas.tsx` — committed elements (slow layer)
- `InteractiveCanvas.tsx` — selection handles, cursors (fast layer)
- `NewElementCanvas.tsx` — preview of element being drawn

Caching is two-tier:
- `ShapeCache` (`shape.ts:81`): `WeakMap<element, Drawable>` for roughjs paths.
- `elementWithCanvasCache` (`renderElement.ts:603`): per-element offscreen canvas, blitted via `drawImage`.

Throttling: `throttleRAF` (`utils.ts:155`) collapses synchronous calls into one paint per frame.

### Perf opportunities for quickdraw (ranked by ROI)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | **Split static vs interactive Konva layers.** Committed shapes on one `<Layer listening={false}>`, selection handles/draft on another. Dragging stops re-rendering all shapes. | S | Huge |
| 2 | **`throttleRAF` wrapper on `setDraft` / pointer-move state.** Currently each `onPointerMove` triggers a React render. | S | High |
| 3 | **`React.memo` shape components with identity guard.** Today every shape re-renders when any other changes. | S | High |
| 4 | **Viewport culling** (`isElementInViewport`, `sizeHelpers.ts:78`): skip shapes outside visible bounds before rendering. | S | Medium (matters once scenes get big) |
| 5 | **Offscreen canvas cache for freehand strokes** keyed on shape identity, blit via `drawImage`. Pen strokes are the heaviest shape type. | M | Medium |
| 6 | **Konva `perfectDrawEnabled={false}` + `hitStrokeWidth`** tuning on lines/arrows. Free perf, no logic change. | XS | Small |
| 7 | **Scene nonce pattern** (`Scene.ts:304`): bump integer on mutation, memoize visible-elements compute on it. | S | Small (your scenes are tiny) |
| 8 | **Pointer events with `passive: true`** + batched updates. | XS | Small |

Skip: spatial index for hit-testing (linear scan is fine <500 shapes), `OffscreenCanvas` workers (overkill), `getCoalescedEvents` (only matters for stylus).

---

## 4. AI-first — biggest gap, biggest opportunity

The agent's blunt summary: **a SKILL.md on a GUI is human-first with an adapter; quickdraw should let agents render images without a browser at all.**

### Five proposed surface changes

```bash
# Headless render — no browser, no block
quickdraw render --spec scene.json --out file.png
echo '{"shapes":[...]}' | quickdraw render --spec - --out file.png

# Pre-populated browser session for human refinement
quickdraw open --spec annotations.json screenshot.png

# Round-trip: extract embedded scene from PNG
quickdraw inspect file.png --json

# Mermaid / dot adapters
echo "graph LR; A-->B" | quickdraw render --mermaid - --out flow.png
```

### Agent-friendly scene spec (vs Excalidraw's verbose format)

```json
{
  "canvas": { "width": 800, "height": 500 },
  "shapes": [
    { "type": "rect", "x": 40, "y": 160, "width": 200, "height": 80,
      "color": "blue", "label": "Login Form" },
    { "type": "arrow", "from": [240,200], "to": [300,200],
      "color": "red", "label": "submit" },
    { "type": "text", "x": 40, "y": 280, "text": "Step 1",
      "color": "dark", "fontSize": 16 }
  ]
}
```

Key design wins over Excalidraw's format:
- **Named colors** (`red`/`blue`/`dark`) — LLMs emit names reliably, hex codes unreliably.
- **`label` on rect/arrow** — auto-positioned text. Saves agent from manual text placement.
- **`from`/`to` arrows** — coord pairs, not flat `[x1,y1,x2,y2]` array.
- **No `id`, no `version`, no `seed`** — generated at load.

### Headless renderer options

| Option | Verdict |
|---|---|
| **Konva server-side + `canvas` (Cairo)** | **Recommended.** Shares ~90% drawing logic with browser Konva. Native dep is acceptable. |
| node-canvas + manual reimplementation | Duplicates render logic; text metrics drift. |
| Puppeteer against existing Vite app | 300MB Chromium, 800ms cold start. Daemon mode possible. |
| satori + resvg | Bad for arrowheads + freehand. |

### Feedback loop: embed scene in PNG `tEXt` chunk

Excalidraw embeds compressed JSON under key `application/vnd.excalidraw+json` using `png-chunk-text` + `png-chunks-encode`. ~10 lines in `server.ts` after save; unlocks `inspect`, re-edit, and agent-side diffing without sidecar files.

### SKILL.md upgrades

Add: decision tree (when to use `render` vs `open` vs `shot`), inline schema with 20-line example, named color table, negative examples ("not for data viz"), feedback-loop section.

---

## Files we'd touch in quickdraw

| Existing file | Change |
|---|---|
| `web/App.tsx` | Split into ~5 files: `Canvas.tsx`, `TextEditor.tsx`, `Toolbar.tsx`, `Selection.tsx`, `useShapes.ts`. Replace `window.prompt`. |
| `web/tools/types.ts` | Expand shape base, add `version`, `angle`, text wrapping fields. |
| `src/cli.ts` | Add `render` / `inspect` subcommands; support `--spec` (file or `-`). |
| `src/server.ts` | Add `CliMode { kind: "render", spec }` branch; embed PNG `tEXt` chunk on save. |
| `SKILL.md` | Add decision tree, schema, named colors, examples. |

### New files

| Path | Purpose |
|---|---|
| `src/render.ts` | Headless Konva renderer (`renderScene(spec) => Buffer`). |
| `src/spec.ts` | Scene spec schema + normalizer (named colors → hex, `from`/`to` → points, auto-generate IDs). |
| `src/png-metadata.ts` | Encode/decode scene in PNG `tEXt` chunk. |
| `web/canvas/TextEditor.tsx` | Excalidraw-style textarea-over-canvas WYSIWYG. |
| `web/canvas/textMeasurement.ts` | Port of `textMeasurements.ts` + `textWrapping.ts`. |
| `web/canvas/transformHandles.ts` | 8 resize handles + rotation. |
| `web/canvas/hitTest.ts` | Two-tier hit testing. |

---

## Suggested phasing

**Phase 1 — AI-first foundation (highest leverage, ~13h):**
- Scene spec + normalizer
- `render` subcommand + headless Konva
- PNG metadata embed/extract
- SKILL.md rewrite with decision tree
- `open --spec` for pre-populated sessions

**Phase 2 — Text overhaul (~10h):**
- WYSIWYG textarea editor (port `textWysiwyg.tsx`)
- Text measurement + wrapping
- Double-click to re-edit
- Font size / alignment controls

**Phase 3 — Selection upgrade (~12h):**
- 8 resize handles + rotation
- Two-tier hit testing
- Multi-select + nudge keys
- Aspect-lock with Shift
- Arrow endpoint editor

**Phase 4 — Perf + polish (~6h, can be done concurrent with phase 2/3):**
- Split static vs interactive Konva layers
- `throttleRAF`
- `React.memo` on shapes
- Z-order actions

---

## Open questions

1. **Which phase first?** Phase 1 (AI-first) gives the biggest user-visible uplift for the original goal. Phase 2 (text) directly fixes what you flagged. Both at once is ~23h.
2. **Headless renderer dep:** OK with native `canvas` (Cairo) install friction, or prefer pure-JS path?
3. **Spec format scope:** keep minimal (rect/arrow/text/pen/highlight) or also support groups/frames/bound-text now?
4. **PNG metadata format:** match Excalidraw's `application/vnd.excalidraw+json` key (cross-tool compat) or use our own `application/vnd.quickdraw+json`?
5. **`/tmp/excalidraw` cache:** keep for ongoing reference or clean up?
