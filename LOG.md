# LOG

## 2026-05-15

### Step 0 - Context and gates

- Loaded `impeccable`, `make-interfaces-feel-better`, and `interactive-system-explainer` instructions.
- Checked memory for cldraw-specific prior decisions: browser-first Bun/React/Konva, AI artifact push-back, and review gates.
- Inspected `PLAN.md`, current CLI/server/web implementation, `README.md`, `SKILL.md`, and smoke harness.
- Impeccable context was missing; added `PRODUCT.md` and `DESIGN.md` from repo evidence so product UI decisions have a stable project context.
- Kiri session rename was attempted for the cldraw session but the MCP call failed on a missing project-local `settings.json`.

### Step 1 - AI-first foundation

Planned substeps:

- Add scene spec schema and normalizer for agent-authored JSON.
- Add headless render and inspect CLI paths.
- Embed and extract PNG scene metadata for round trips.
- Add `open --spec` to pre-populate browser sessions.
- Extend the browser save path to preserve scene metadata.
- Expand the test harness to cover render, inspect, open/edit, and browser draw/save flows.
- Run review subagent after the chunk and fix findings before moving to the next chunk.

Progress:

- Wired public CLI actions for `render --spec ... --out ...`, `inspect <png>`, and `open --spec ... [image]`.
- Kept existing browser modes but allowed `edit`, `paste`, and `shot` to accept `--spec`.
- Updated `SKILL.md` and `README.md` around the AI-first command path, scene spec, named colors, and PNG round trip.
- Expanded `scripts/smoke.ts` to invoke the CLI render/inspect path, assert PNG output, assert embedded metadata, and cover browser save with a preloaded scene.
- Review gate found image-backed `--spec` dimension drift, detached generated labels, browser text style drift, and missing CLI browser coverage.
- Fixed spec normalization so browser sessions can preserve image/viewport dimensions when `canvas` is omitted.
- Kept `label` on rect/arrow shapes and render labels as part of the same shape in browser and headless output, so moving a base shape does not strand its label.
- Made browser text rendering honor `fontSize`, `fontFamily`, and `textAlign`.
- Added an end-to-end CLI browser smoke path using `QUICKDRAW_NO_OPEN` + `QUICKDRAW_URL_FILE` to drive `open --spec` through the real command.
- Re-ran `bun run typecheck` and `bun run smoke`; both passed after fixes.
- Second review gate found saved-PNG double-render on `inspect -> open --spec ... saved.png`, incomplete text alignment semantics, and weak metadata assertions.
- Fixed CLI image mode to detect when a supplied image already contains the same quickdraw scene and reopen it as a scene-only round trip instead of using the rasterized PNG as a background.
- Adjusted browser text rendering/selection bounds so `center` and `right` align around the same `x` anchor semantics as headless SVG output.
- Strengthened smoke metadata checks to compare shape payloads, not just dimensions/counts, and added CLI-backed tests for `edit <image> --spec` dimension fallback plus saved-PNG reopen source kind.
- Third review gate found the browser text anchor was still using estimated widths and smoke did not assert `fontFamily`.
- Switched browser text width to canvas `measureText` with no-wrap Konva text and added `fontFamily` plus center/right alignment to smoke specs.

### Step 2 - Text editing

Planned substeps:

- Replace prompt-based text creation with a real textarea over the canvas.
- Support commit/cancel keyboard behavior and double-click re-edit.
- Add compact font size, font family, and alignment controls.
- Add smoke coverage for create/edit/save text.

Progress:

- Added `web/canvas/TextEditor.tsx` and integrated it into `web/App.tsx`.
- Text creation now opens a focused textarea at the pointer location; Enter commits, Shift+Enter keeps a newline, Escape cancels, and blur commits.
- Double-clicking an existing text shape reopens it for editing without duplicating the shape.
- Added toolbar controls for font size, font family, and text alignment.
- Added `scripts/smoke.ts` coverage for creating text, re-editing it, saving, and asserting the embedded scene contains the edited text.
- Review gate found active-edit toolbar changes were not applied, Enter from toolbar controls triggered global save, center/right editing was not WYSIWYG, and the smoke did not prove same-shape replacement.
- Made the text editor controlled, let toolbar blur avoid commit while updating the live draft, blocked textarea key propagation, and anchored the textarea with the same measured text metrics as committed canvas text.
- Strengthened text smoke to apply alignment/font controls during editing, press Enter while a toolbar select is focused, re-edit the same text shape, and assert one formatted text shape is saved.
- Follow-up review found textarea auto-resize was overriding the measured width for center/right aligned text.
- Kept textarea width controlled by the same measured metric as committed text and limited auto-resize to height.
- Final focused review found CSS `min-width` still clamped short centered/right text and could drift from the committed anchor.
- Removed the width clamp and added a live smoke assertion that a centered text editor remains anchored on the click point before commit.

### Step 3 - Selection and transforms

Planned substeps:

- Upgrade selection state to support multiple selected shapes.
- Add keyboard nudging with 1px and Shift+5px movement.
- Add resize handles with Shift aspect-lock.
- Add a rotation handle for rect/text shapes and preserve angle in scene metadata/headless render.
- Add smoke coverage for select/nudge/resize/rotate.

Progress:

- Replaced single `selectedId` with `selectedIds` and added Shift-click toggle selection.
- Delete, drag, and keyboard nudge now operate over the selected set.
- Added eight resize handles for the active single selection; scaling works for rects, text, arrows, and pen strokes.
- Added a rotation handle for rect/text shapes plus `angle` in the normalized scene spec and SVG renderer.
- Added `scripts/smoke.ts` coverage that selects a rect, nudges it, resizes it, rotates it, saves, and checks metadata.
- Review gate found Shift-click multi-select was broken, rotated text edit dropped angle, rotated selection handles implied unsupported resize math, and rotated browser/headless text origins differed.
- Fixed selection event flow by clearing only from the actual background and handling desktop selection on pointer-down.
- Preserved text `angle` through edit drafts and textarea overlay rotation.
- Stopped showing resize handles on already-rotated rect/text shapes while keeping the rotated selection outline and rotation handle.
- Aligned headless rotated text around the same top anchor by using SVG hanging baseline.
- Added smoke coverage for Shift-click multi-select delete and rotated text re-edit preserving angle.
- Follow-up review found no code blockers, but required a smoke assertion for rotated browser/headless text-origin parity.
- Added a no-dependency parity smoke that renders the same rotated text scene through headless CLI and browser Save, then compares ImageMagick-trimmed visible bounds within tolerance.

### Step 4 - Performance pass

Planned substeps:

- Split static content from interactive overlay work.
- Throttle high-frequency pointer draft updates to animation frames.
- Memoize shape rendering and avoid expensive Konva perfect draw where it is not needed.
- Preserve behavior with typecheck and smoke after the changes.

Progress:

- Split the stage into background, non-listening rendered shapes, and interactive overlay layers.
- Moved shape rendering into a memoized `ShapeNode` component.
- Added requestAnimationFrame throttling for pointer-move draft updates.
- Disabled Konva perfect draw on primitive rendered shapes where the visual cost is not useful for this utility.
- Review gate found stale RAF draft commits, Save dropping an active text edit, and image-backed deselect regression.
- Fixed pointer moves to accumulate from `draftRef.current` and commit the latest queued draft on pointer-up.
- Made Save serialize an active text draft before closing, with smoke coverage for saving directly from a focused textarea.
- Restored image-background deselect by naming the Konva image and treating it as an empty canvas target.
- Follow-up review found the active text draft was still absent from the raster capture, transform proxies lacked live visual feedback, and smoke coverage was metadata-only for active text/RAF/image deselect.
- Kept the active text draft in the Konva render tree while editing so raster capture and metadata agree.
- Added transform preview state for live move/resize/rotate feedback while preserving one history entry on drag end.
- Strengthened smoke to assert final pen endpoints, visible active-text raster bounds, and image-backed deselect behavior.

### Step 5 - Adapter render gap

Planned substeps:

- Add `render --mermaid` and `render --dot` as the missing AI-first adapter path from `PLAN.md`.
- Prefer installed renderer binaries, then use `bunx` fallbacks so a fresh agent can still produce a PNG.
- Embed source metadata so `inspect` can confirm adapter provenance.
- Extend smoke coverage for adapter render and inspect.

Progress:

- Added adapter rendering for Mermaid and DOT sources.
- DOT uses Graphviz `dot` when present and falls back to `bunx @hpcc-js/wasm-graphviz-cli`.
- Mermaid uses `mmdc` when present and falls back to `bunx @mermaid-js/mermaid-cli`.
- Updated `README.md` and `SKILL.md` with adapter examples and renderer fallback behavior.
- Added smoke coverage for `render --dot`, `render --mermaid`, PNG output, and inspect metadata.
- Review gate found adapter inspect metadata could be passed back as `--spec` and reopen as an empty scene, plus the fallback depended on `npx`.
- Tightened `--spec` validation so adapter metadata is not accepted as a scene spec and switched fallbacks to Bun's package runner.
- Follow-up review found malformed scene shape arrays were still accepted by browser `--spec` paths.
- Validated browser `--spec` with `normalizeScene` before starting the server and added malformed-spec smoke coverage.

### Step 6 - Text wrapping and measurement

Planned substeps:

- Add the missing fixed-width text wrapping surface from `PLAN.md`.
- Keep browser and headless render behavior aligned enough for AI-authored specs.
- Make text resize handles adjust the wrapping box instead of only scaling font size.
- Add smoke coverage for wrapped text metadata and raster output.

Progress:

- Added shared text layout/wrapping logic with line-height and fixed-width support.
- Extended text shape/spec fields with `width`, `originalText`, `lineHeight`, `autoResize`, `verticalAlign`, and `containerId`.
- Updated browser text rendering, selection bounds, textarea overlay, and text resize behavior to use the shared layout.
- Updated headless SVG text rendering to emit wrapped lines from the same layout model.
- Documented `width` and `lineHeight` in `README.md` and `SKILL.md`.
- Added smoke coverage that renders wrapped text through both CLI/headless and browser Save, then asserts metadata and multi-line raster output.
- Review gate found browser/headless measurement drift, leading long-token overflow, and `originalText` trimming on normalize.
- Switched browser rendering to the shared deterministic width model, split leading overlong tokens, preserved raw `originalText`, and expanded smoke coverage for those cases.
- Follow-up review found re-edit still seeded from trimmed `text` instead of raw `originalText`.
- Re-edit now restores `originalText`, and smoke reopens wrapped text to assert the textarea value preserves raw whitespace.
- Fixed the wrapped-text smoke harness to close the first temporary server before starting the re-edit server and to handle the intentional cancel rejection.
- Follow-up review found fixed-width text still had browser/headless vertical raster drift.
- Shifted headless fixed-width text to match Konva's wrapped-text baseline and added wrapped browser/headless bounds comparison to smoke.

### Step 7 - Arrow endpoint editing

Planned substeps:

- Add the missing arrow endpoint editor from `PLAN.md`.
- Keep endpoint edits in the existing transform preview model so dragging gives live feedback and commits one history entry.
- Add smoke coverage for selecting an arrow, dragging one endpoint, saving, and verifying metadata.

Progress:

- Added selected-arrow point handles for direct endpoint movement.
- Disabled generic resize handles on selected arrows so endpoint editing is the explicit arrow interaction.
- Added transform preview support for arrow point edits.
- Added smoke coverage that drags one arrow endpoint and asserts the other endpoint remains stable.
- Review found no blockers but noted the smoke did not guard against generic resize handles returning on arrows.
- Added explicit endpoint-handle and no-generic-resize-handle assertions for selected arrows.

### Step 8 - Z-order actions

Planned substeps:

- Add the missing bring-to-front/send-to-back actions from `PLAN.md`.
- Preserve relative order for multi-selected shapes.
- Add smoke coverage proving saved scene order changes.

Progress:

- Added toolbar controls for send-to-back and bring-to-front on selected shapes.
- Implemented array-order reordering with selected shapes kept in their relative order.
- Documented z-order support in `README.md` and `SKILL.md`.
- Added smoke coverage that sends an overlapping selected shape behind another and asserts saved metadata order.
- Review found no-op z-order actions created dead undo entries and smoke only covered a narrow single-shape send-to-back path.
- No-op reorders now leave history unchanged, and smoke covers undo, bring-to-front, and multi-select send-to-back with relative selected order preserved.
- Follow-up review found the z-order test id had been placed on a broad bounding-box hit target, preserving an existing imprecise line/rotated hit-test bug.
- Replaced broad hit rectangles with geometry-shaped hit targets for pen, arrow, rotated rect, and rotated text, while keeping stable hit-node ids for order assertions.
- Added smoke coverage proving a click in empty space inside a diagonal pen's bounding box does not select/delete the stroke.

### Step 9 - Completion audit fixes

Progress:

- Final audit review found `open --spec <scene> <annotated-image>` could drop the image if the PNG already contained matching scene metadata.
- Simplified the CLI contract so an explicit image argument always opens image-backed mode; scene-only round trip remains `open --spec <scene>` without an image argument.
- Updated smoke coverage to inspect an image-backed save and reopen it with the saved PNG still present as the image source.
- Re-ran `git diff --check`, `bun run typecheck`, and `bun run smoke`; all passed.
- Follow-up review found no blockers in the image-backed round-trip fix and classified remaining PLAN research items as non-blocking follow-ups: binding/snapping, deeper hit-test extraction, viewport/offscreen caching, and file splitting.
