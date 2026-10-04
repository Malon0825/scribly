import { getStrokePoints } from "perfect-freehand";

export type ScreenInkPoint = { x: number; y: number };

// The library streamlines pointer samples; quadratic SVG segments round the
// centerline while retaining the app's constant-width, theme-colored pen.
// Keep these parameters stable: saved assisted strokes use this same renderer.
export function inkPath(points: ScreenInkPoint[], smooth = false): string {
  if (!points.length) return "";
  if (points.length === 1) points = [points[0], { x: points[0].x + .1, y: points[0].y }];
  const xy = (p: ScreenInkPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  if (!smooth) return points.map((p, i) => `${i ? "L" : "M"}${xy(p)}`).join(" ");
  // last:true keeps the tip at the actual pointer during preview and on release.
  const curve = getStrokePoints(points, { size: 1, streamline: .4, last: true }).map(({ point }) => ({ x: point[0], y: point[1] }));
  let path = `M${xy(curve[0])}`;
  for (let i = 1; i < curve.length; i++) {
    const point = curve[i], next = curve[i + 1];
    const end = next ? { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 } : point;
    path += ` Q${xy(point)} ${xy(end)}`;
  }
  return path;
}
