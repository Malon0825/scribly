export const elementSizes = [
  { value: "small", label: "Small", scale: 0.9 },
  { value: "medium", label: "Medium", scale: 1 },
  { value: "large", label: "Large", scale: 1.1 },
] as const;
export const textSizes = [
  { label: "Small", value: 90 },
  { label: "Medium", value: 100 },
  { label: "Large", value: 120 },
] as const;

const systemFont = '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
export const noteFonts = [
  { id: "system", label: "Segoe UI · Default", family: systemFont },
  { id: "roboto", label: "Roboto", family: '"Roboto", ' + systemFont },
  { id: "roboto-light", label: "Roboto Light", family: '"Roboto", ' + systemFont },
  { id: "calibri", label: "Calibri", family: '"Calibri", "Lato", ' + systemFont, local: ["Calibri"], fallback: "Lato" },
  { id: "helvetica", label: "Helvetica", family: '"Helvetica", "Helvetica Neue", "Lato", ' + systemFont, local: ["Helvetica", "Helvetica Neue"], fallback: "Lato" },
  { id: "lato", label: "Lato", family: '"Lato", ' + systemFont },
  { id: "simple-notes", label: "Simple Notes", family: '"Simple Notes", "Simple Notes Regular", "Caveat", ' + systemFont, local: ["Simple Notes", "Simple Notes Regular"], fallback: "Caveat" },
  { id: "caveat", label: "Caveat", family: '"Caveat", ' + systemFont },
  { id: "itim", label: "Itim", family: '"Itim", ' + systemFont },
  { id: "gaegu", label: "Gaegu", family: '"Gaegu", ' + systemFont },
  { id: "gochi-hand", label: "Gochi Hand", family: '"Gochi Hand", ' + systemFont },
] as const;
export type Appearance = {
  elementSize: (typeof elementSizes)[number]["value"];
  textScale: number;
  font: (typeof noteFonts)[number]["id"];
};
export const defaultAppearance: Appearance = { elementSize: "medium", textScale: 100, font: "system" };

// Older notebooks have no appearance field. Invalid values cannot break the layout.
export function normalizeAppearance(value?: Partial<Appearance> | null): Appearance {
  return {
    elementSize: elementSizes.some((size) => size.value === value?.elementSize)
      ? value!.elementSize! : defaultAppearance.elementSize,
    textScale: typeof value?.textScale === "number" && Number.isFinite(value.textScale)
      ? Math.min(150, Math.max(80, Math.round(value.textScale))) : defaultAppearance.textScale,
    font: noteFonts.some((font) => font.id === value?.font)
      ? value!.font! : defaultAppearance.font,
  };
}
