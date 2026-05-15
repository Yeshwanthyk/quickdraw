# Design

## Visual Theme

Restrained product utility: cool tinted neutrals, one blue action accent, small status colors only for state. The work happens in the image, not in decorative UI.

## Color

- Background: cool neutral workspace.
- Surface: near-white toolbar and panels, never pure white where a tinted neutral reads cleaner.
- Accent: blue for active tool, focus, and primary save.
- Danger: red only for save failures or destructive actions.

## Typography

Native system sans-serif. Compact labels, tabular numbers for dimensions and telemetry, balanced text only for headings in documentation artifacts.

## Components

- Toolbar: dense, icon-first, segmented by dividers.
- Tool buttons: square icon buttons with active, hover, focus, disabled, and pressed states.
- Swatches: circular color chips with explicit active outline.
- Canvas: large scrollable rail, stable dimensions, image-like outline.

## Motion

Use short, interruptible transitions on color, border-color, opacity, and transform only. Button press feedback uses `scale(0.96)`. Avoid page-load choreography.

## Performance

Keep committed image/shapes separate from interactive selection/draft work. Throttle high-frequency pointer updates to animation frames and avoid re-rendering unchanged shapes.
