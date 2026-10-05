// The pinned npm catalog is build input, never imported by the webview.
import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const directory = 'node_modules/@thesvg/icons/dist';
const output = 'public/brand-logos';
if (process.argv.includes('--if-needed')) {
  try {
    const catalog = JSON.parse(await readFile(`${output}/catalog.json`, 'utf8'));
    if (catalog.version === '3.3.12' && catalog.icons.length) process.exit(0);
  } catch { /* First checkout: generate the pinned, offline assets. */ }
}
await mkdir(output, { recursive: true });
const icons = [], skipped = [];
let bytes = 0, assets = 0;
for (const name of (await readdir(directory)).sort()) {
  if (!name.endsWith('.js') || ['index.js', 'types.js'].includes(name)) continue;
  const icon = (await import(pathToFileURL(resolve(directory, name)).href)).default;
  if (!icon?.slug || !/^[a-z0-9][a-z0-9-]*$/.test(icon.slug)) continue;
  const variants = [];
  for (const [variant, svg] of Object.entries(icon.variants)) {
    if (!/^[a-zA-Z]+$/.test(variant) || typeof svg !== 'string') continue;
    // Retain original marks. Reject executable/external assets rather than
    // changing their artwork. Runtime insertion rasterizes these local files.
    if (Buffer.byteLength(svg) > 250_000 || !/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg)
      || /<(?:script|foreignObject|iframe|image|animate|set)\b|\bon[a-z]+\s*=|<!DOCTYPE|<!ENTITY|@import|(?:href\s*=\s*["']\s*(?!#))|url\(\s*["']?(?!#)/i.test(svg)) {
      skipped.push(`${icon.slug}/${variant}`); continue;
    }
    await mkdir(`${output}/${icon.slug}`, { recursive: true });
    const path = `${output}/${icon.slug}/${variant}.svg`;
    let existing;
    try { existing = await readFile(path, 'utf8'); } catch { /* New asset. */ }
    if (existing !== svg) await writeFile(path, svg);
    variants.push(variant); bytes += Buffer.byteLength(svg); assets++;
  }
  if (!variants.includes('default')) continue;
  icons.push({ slug: icon.slug, title: icon.title.trim(), aliases: icon.aliases, categories: icon.categories, variants,
    license: icon.license, url: /^https?:\/\//.test(icon.url) ? icon.url : '', hex: icon.hex });
}
await writeFile(`${output}/catalog.json`, JSON.stringify({ version: '3.3.12', icons }));
const license = await readFile('node_modules/@thesvg/icons/LICENSE', 'utf8');
await writeFile('public/brand-logo-licenses.txt', `theSVG 3.3.12 — https://thesvg.org — https://github.com/glincker/thesvg\n\n${license}\n\nBrand marks remain the trademarks of their owners. Per-icon license and source metadata are preserved in brand-logos/catalog.json and inserted components. AWS architecture artwork © Amazon Web Services, Inc. is provided under CC BY-ND 2.0: https://creativecommons.org/licenses/by-nd/2.0/. The app displays original marks with preserved proportions; canvas insertion uses a PNG rendering for compatibility with the existing notebook image format.\n`);
console.log(JSON.stringify({ icons:icons.length, assets, svgBytes:bytes, skipped:skipped.length }));
