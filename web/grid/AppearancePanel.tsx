import type { FillStyle, StrokeStyle } from "../../src/spec";

export type GridStyle = {
  border: StrokeStyle;
  fill: FillStyle;
  rounded: boolean;
  dashed: boolean;
};

export const defaultGridStyle: GridStyle = { border: "single", fill: "none", rounded: false, dashed: false };

const FILLS: Array<{ value: FillStyle; glyph: string; title: string }> = [
  { value: "none", glyph: "·", title: "No fill" },
  { value: "solid", glyph: "█", title: "Solid" },
  { value: "shade", glyph: "░", title: "Shade" },
  { value: "dense", glyph: "▓", title: "Dense" },
  { value: "half", glyph: "▌", title: "Half" }
];

const BORDERS: Array<{ value: StrokeStyle; glyph: string; title: string }> = [
  { value: "none", glyph: "·", title: "No border" },
  { value: "single", glyph: "─", title: "Single" },
  { value: "bold", glyph: "━", title: "Bold" },
  { value: "double", glyph: "═", title: "Double" }
];

type Props = {
  style: GridStyle;
  onChange: (style: GridStyle) => void;
};

export function AppearancePanel({ style, onChange }: Props) {
  return (
    <aside className="appearancePanel" aria-label="Appearance">
      <h2 className="appearanceTitle">Appearance</h2>

      <div className="appearanceGroup">
        <span className="appearanceLabel">Fill</span>
        <div className="appearanceRow">
          {FILLS.map((option) => (
            <GlyphButton key={option.value} glyph={option.glyph} title={option.title} active={style.fill === option.value} onClick={() => onChange({ ...style, fill: option.value })} />
          ))}
        </div>
      </div>

      <div className="appearanceGroup">
        <span className="appearanceLabel">Border</span>
        <div className="appearanceRow">
          {BORDERS.map((option) => (
            <GlyphButton key={option.value} glyph={option.glyph} title={option.title} active={style.border === option.value} onClick={() => onChange({ ...style, border: option.value })} />
          ))}
        </div>
      </div>

      <div className="appearanceGroup">
        <span className="appearanceLabel">Options</span>
        <div className="appearanceRow">
          <GlyphButton glyph="╭" title="Rounded corners" active={style.rounded} onClick={() => onChange({ ...style, rounded: !style.rounded })} />
          <GlyphButton glyph="┄" title="Dashed" active={style.dashed} onClick={() => onChange({ ...style, dashed: !style.dashed })} />
        </div>
      </div>

      <p className="appearanceHint">Applies to new shapes</p>
    </aside>
  );
}

function GlyphButton(props: { glyph: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button className={props.active ? "glyphButton active" : "glyphButton"} title={props.title} aria-label={props.title} aria-pressed={props.active} onClick={props.onClick}>
      {props.glyph}
    </button>
  );
}
