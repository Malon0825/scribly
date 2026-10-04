import { useEffect, useState } from "react";
import { AppSelect } from "./AppSelect";
import { defaultAppearance, elementSizes, noteFonts, type Appearance } from "./appearance";

export function AppearanceSettings({ value, onChange }: {
  value: Appearance;
  onChange: (value: Appearance) => void;
}) {
  const font = noteFonts.find((item) => item.id === value.font)!;
  const [localAvailable, setLocalAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let gone = false;
    setLocalAvailable(null);
    if ("local" in font) {
      void Promise.all(font.local.map((name) =>
        new FontFace("Scribly font check", `local("${name}")`).load()
          .then(() => true, () => false),
      )).then((available) => { if (!gone) setLocalAvailable(available.some(Boolean)); });
    }
    return () => { gone = true; };
  }, [font]);
  return (
    <div className="appearance-settings">
      <div className="preference-heading">
        <span className="settings-label">Size & type</span>
        <button className="reset-appearance" onClick={() => onChange({ ...defaultAppearance })}>Reset defaults</button>
      </div>
      <div className="size-setting">
        <span id="element-size-label" className="field-label">App elements</span>
        <div className="size-options" role="group" aria-labelledby="element-size-label">
          {elementSizes.map((size) => <button key={size.value} aria-pressed={value.elementSize === size.value}
            onClick={() => onChange({ ...value, elementSize: size.value })}>{size.label}</button>)}
        </div>
        <p className="setting-hint">Resize controls, icons, and spacing.</p>
      </div>
      <div className="size-setting">
        <span id="text-size-label" className="field-label">Text size</span>
        <div className="text-size-slider">
          <input type="range" min="80" max="150" step="5" aria-label="Text size" aria-labelledby="text-size-label"
            aria-valuetext={`${value.textScale} percent`} value={value.textScale}
            onChange={(e) => onChange({ ...value, textScale: Number(e.target.value) })} />
          <output>{value.textScale}%</output>
        </div>
        <p className="setting-hint">Adjust text throughout the app, independently of controls.</p>
      </div>
      <label className="field-label" htmlFor="note-font">Note font</label>
      <AppSelect className="form-input" id="note-font" label="Note font" value={value.font} describedBy="font-availability"
        onChange={(font) => onChange({ ...value, font: font as Appearance["font"] })}
        options={noteFonts.map((item, index) => ({ value: item.id, label: item.label, group: index < 6 ? "Clean & simple" : "Handwritten" }))} />
      <p className="setting-hint" id="font-availability" aria-live="polite">
        {"local" in font
          ? localAvailable === null ? "Checking installed font…"
            : localAvailable ? `Uses ${font.label} installed on this laptop.`
            : `${font.label} isn't installed. Using ${font.fallback}. Install your licensed copy in Windows to use it.`
          : font.id === "system" ? "Uses your system font."
            : "Included with Scribly. Available offline."}
      </p>
      <div className="font-preview" aria-label="Font preview">
        <strong>A little space for your thoughts</strong>
        <p>Write a note, make a list, start something new.</p>
        <span>Today · Aa Bb Cc · 0123456789</span>
      </div>
      <p className="setting-hint">Note fonts apply to titles, the editor, and Reference. Changes save automatically.</p>
    </div>
  );
}
