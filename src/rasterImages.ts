export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function rasterType(bytes: Uint8Array): string | null {
  if (bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG") return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (/^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))) return "gif";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
export function safeInlineImageSource(value: unknown): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) return false;
  const match = value.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) return false;
  try { return rasterType(Uint8Array.from(atob(match[2].slice(0, 24)), c => c.charCodeAt(0))) === match[1]; }
  catch { return false; }
}
