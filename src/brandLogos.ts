export type BrandLogo = { slug: string; title: string; aliases: string[]; categories: string[]; variants: string[]; license: string; url: string; hex: string };
export const brandAsset = (icon: BrandLogo, variant: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(icon.slug) || !/^[a-zA-Z]+$/.test(variant) || !icon.variants.includes(variant)) throw Error("This logo variant is unavailable.");
  return `/brand-logos/${icon.slug}/${variant}.svg`;
};
export async function loadBrandCatalog(signal: AbortSignal): Promise<BrandLogo[]> {
  const response = await fetch("/brand-logos/catalog.json", { signal });
  if (!response.ok) throw Error("The logo catalog could not be opened. Retry or reinstall the app.");
  const data = await response.json();
  if (!Array.isArray(data.icons) || data.icons.length > 10_000 || !data.icons.every((icon: BrandLogo) =>
    icon && typeof icon.title === "string" && typeof icon.slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(icon.slug) && typeof icon.license === "string"
    && Array.isArray(icon.variants) && icon.variants.includes("default") && icon.variants.every(v => typeof v === "string" && /^[a-zA-Z]+$/.test(v))
    && Array.isArray(icon.aliases) && icon.aliases.every(v => typeof v === "string")
    && Array.isArray(icon.categories) && icon.categories.every(v => typeof v === "string"))) throw Error("The installed logo catalog is invalid.");
  return data.icons;
}
export const brandSearchKey = (icon: BrandLogo) => [icon.title, icon.slug, ...icon.aliases, ...icon.categories].join(" ").normalize("NFKD").toLowerCase();

// Existing board storage accepts raster images, keeping imports/backups and
// native validation unchanged. No remote SVG is ever executed in the DOM.
export async function renderBrandLogo(icon: BrandLogo, variant: string, signal: AbortSignal) {
  const response = await fetch(brandAsset(icon, variant), { signal });
  if (!response.ok) throw Error("This logo could not be opened. Choose another logo or retry.");
  const svg = await response.text();
  if (svg.length > 250_000 || /<(?:script|foreignObject|iframe|image|animate|set)\b|\bon[a-z]+\s*=|<!DOCTYPE|<!ENTITY|@import|(?:href\s*=\s*["']\s*(?!#))|url\(\s*["']?(?!#)/i.test(svg)) throw Error("This logo contains unsupported SVG content.");
  const svgDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = svgDocument.documentElement;
  if (root.localName !== "svg" || svgDocument.querySelector("parsererror")) throw Error("This logo is invalid.");
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.[2] || parseFloat(root.getAttribute("width") || "512");
  const height = viewBox?.[3] || parseFloat(root.getAttribute("height") || "512");
  const sourceRatio = width / height;
  if (!Number.isFinite(sourceRatio) || sourceRatio <= 0 || sourceRatio > 100 || sourceRatio < 0.01) throw Error("This logo has unsupported dimensions.");
  // Bound decoding too, not just the destination canvas. Preserve the viewBox
  // and authored paths/colors while scaling the image viewport proportionally.
  root.setAttribute("width", String(Math.round(sourceRatio >= 1 ? 512 : 512 * sourceRatio)));
  root.setAttribute("height", String(Math.round(sourceRatio <= 1 ? 512 : 512 / sourceRatio)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
  try {
    const image = new Image(); image.src = url; await image.decode(); signal.throwIfAborted();
    const ratio = image.naturalWidth / image.naturalHeight;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100 || ratio < 0.01) throw Error("This logo has unsupported dimensions.");
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(ratio >= 1 ? 512 : 512 * ratio);
    canvas.height = Math.round(ratio <= 1 ? 512 : 512 / ratio);
    const context = canvas.getContext("2d");
    if (!context) throw Error("The logo could not be rendered. Retry after reopening the board.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataURL: canvas.toDataURL("image/png"), ratio };
  } catch (error) {
    if (signal.aborted) throw error;
    throw Error("This logo could not be rendered. Choose another variant or logo.");
  } finally { URL.revokeObjectURL(url); }
}
