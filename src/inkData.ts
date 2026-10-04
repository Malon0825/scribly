export const inkColors = ["yellow", "green", "pink"] as const;
export type InkColor = typeof inkColors[number];
export const drawingColors = ["default", "accent", "red"] as const;
export type DrawingColor = typeof drawingColors[number];
export type StrokeColor = InkColor | DrawingColor;
export type InkPoint = [number, number];
export type InkStroke = { color: StrokeColor; points: InkPoint[]; kind?: "draw"; width?: number; smooth?: boolean };
export function inkWidth(stroke: Pick<InkStroke, "kind" | "width">) { return stroke.width ?? (stroke.kind === "draw" ? 3 : 16); }
export const inkNodes = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "image"];

// Coordinates are relative to the owning block: x/width, y/note-font-size.
// A stroke follows that block when content is inserted above it.
export function readInk(value: unknown): InkStroke[] {
  if (typeof value === "string") {
    if (value.length > 2_000_000) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value) || value.length > 100) return [];
  const output: InkStroke[] = [];
  for (const stroke of value) {
    if (!stroke || (stroke.kind !== undefined && stroke.kind !== "draw")) return [];
    if (stroke.width !== undefined && (typeof stroke.width !== "number" || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 64)) return [];
    if (stroke.smooth !== undefined && (stroke.kind !== "draw" || typeof stroke.smooth !== "boolean")) return [];
    const colors: readonly string[] = stroke.kind === "draw" ? drawingColors : inkColors;
    if (!colors.includes(stroke.color) || !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 512) return [];
    if (stroke.points.some((p: unknown) => !Array.isArray(p) || p.length !== 2 || p.some(v => typeof v !== "number" || !Number.isFinite(v)) || Math.abs(p[0]) > 4 || Math.abs(p[1]) > 500)) return [];
    output.push({ color: stroke.color, points: stroke.points.map((p: InkPoint) => [...p] as InkPoint), ...(stroke.kind === "draw" ? { kind: "draw" as const } : {}), ...(stroke.width !== undefined ? { width: stroke.width } : {}), ...(stroke.smooth !== undefined ? { smooth: stroke.smooth } : {}) });
  }
  return output;
}
export function inkAttributes(value: unknown) {
  const ink = readInk(value);
  return ink.length ? { "data-note-ink": JSON.stringify(ink) } : {};
}
