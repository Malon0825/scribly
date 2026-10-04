import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// The MIT-licensed 0.18.1 editor adds a CDN fallback to every FontFace even
// when EXCALIDRAW_ASSET_PATH is set. Notify bundles the complete font set.
// Remove that fallback. Embed complete local font shards in SVG instead of
// glyph subsetting, whose Emscripten runtime requires JavaScript unsafe-eval.
const root = "node_modules/@excalidraw/excalidraw";
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
if (version !== "0.18.1") throw Error("Review the local-font patch before upgrading Excalidraw.");
const marker = "/* Notify: local fonts only */ void 0";
const fontMarker = "/* Notify: complete local font */";
const dialogMarker = "/* Notify: labelled engine dialog */";
const encode = (value) => `${fontMarker} ((buffer) => { const bytes = new Uint8Array(buffer); let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return "data:font/woff2;base64," + btoa(binary); })(${value})`;
for (const mode of ["dev", "prod"]) {
  let patched = 0, fontsPatched = 0, dialogsPatched = 0;
  const directory = join(root, "dist", mode);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".js")) continue;
    const path = join(directory, file), source = await readFile(path, "utf8");
    let next = source;
    const pattern = /\b\w+\.push\(new URL\(\w+,\s*\w+\.ASSETS_FALLBACK_URL\)\)/g;
    if (source.includes(marker)) patched++;
    else { const matches = source.match(pattern); if (matches?.length) { patched += matches.length; next = next.replace(pattern, marker); } }
    if (source.includes(fontMarker)) fontsPatched++;
    else {
      const fontPattern = mode === "dev" ? /await subsetWoff2GlyphsByCodepoints\(\s*(\w+),\s*codePoints\s*\)/g : /await qd\((\w+),t\)/g;
      const matches = source.match(fontPattern);
      if (matches?.length) { fontsPatched += matches.length; next = next.replace(fontPattern, (_match, buffer) => encode(buffer)); }
    }
    // The pinned Dialog references a bare ID, while its heading includes the
    // editor's unique prefix. Match that heading instead of inventing a name.
    if (source.includes(dialogMarker)) dialogsPatched++;
    else {
      const label = mode === "dev" ? 'labelledBy: "dialog-title"' : 'labelledBy:"dialog-title"';
      if (source.includes(label)) {
        const heading = mode === "dev" ? /id: `\$\{(\w+)\}-dialog-title`, className: "Dialog__title"/g : /id:`\$\{(\w+)\}-dialog-title`,className:"Dialog__title"/g;
        const matches = [...source.matchAll(heading)];
        if (source.split(label).length !== 2 || matches.length !== 1) throw Error(`Expected one ${mode} engine dialog heading and label.`);
        next = next.replace(label, dialogMarker + " labelledBy: `${" + matches[0][1] + "}-dialog-title`");
        dialogsPatched++;
      }
    }
    if (next !== source) await writeFile(path, next);
  }
  if (patched !== 1) throw Error(`Expected exactly one ${mode} font fallback; found ${patched}.`);
  if (fontsPatched !== 1) throw Error(`Expected exactly one ${mode} SVG font encoder; found ${fontsPatched}.`);
  if (dialogsPatched !== 1) throw Error(`Expected exactly one ${mode} engine dialog label; found ${dialogsPatched}.`);
}
console.log("Excalidraw local-font and accessible-dialog patches applied.");

// Mermaid 11.17 prefixes cluster DOM IDs with the render ID. The pinned
// converter still looks up bare IDs, then silently falls back to an image.
const converter = "node_modules/@excalidraw/mermaid-to-excalidraw";
if (JSON.parse(await readFile(join(converter, "package.json"), "utf8")).version !== "2.2.2")
  throw Error("Review the Mermaid subgraph patch before upgrading the converter.");
const parser = join(converter, "dist/parser/flowchart.js");
const source = await readFile(parser, "utf8");
const selector = 'const el = containerEl.querySelector(`[id=\'${data.id}\']`);';
const clusterMarker = "/* Notify: Mermaid prefixed cluster IDs */";
if (!source.includes(clusterMarker)) {
  if (source.split(selector).length !== 2) throw Error("Expected one Mermaid subgraph selector.");
  await writeFile(parser, source.replace(selector, `${clusterMarker}
    const renderId = containerEl.querySelector("svg")?.id;
    const el = Array.from(containerEl.querySelectorAll(".cluster")).find((node) => node.id === data.id || node.id === renderId + "-" + data.id);`));
}
console.log("Mermaid subgraph compatibility patch applied.");
