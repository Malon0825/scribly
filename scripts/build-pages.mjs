import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".build-pages");
await mkdir(output, { recursive: true });

const html = (await readFile(join(root, "assets/webpage.html"), "utf8"))
  .replaceAll("../docs/images/", "docs/images/")
  .replaceAll("../public/", "branding/");
await writeFile(join(output, "index.html"), html);
await writeFile(join(output, ".nojekyll"), "");

async function copy(source, destination) {
  await mkdir(join(output, destination), { recursive: true });
  for (const file of source.files) {
    await copyFile(join(root, source.directory, file), join(output, destination, file));
  }
}

await copy({ directory: "docs/images", files: ["light.webp", "dark.webp", "notebook.webp"] }, "docs/images");
await copy({ directory: "public", files: ["scribly-wordmark.webp", "scribly-icon.png", "scribly-icon-dark.png"] }, "branding");
await copy({ directory: "assets/screenshots", files:
  ["markup", "reference", "architecture"].flatMap(section =>
    ["light", "dark", "notebook"].map(theme => `${section}-${theme}.png`)),
}, "screenshots");

console.log("GitHub Pages website packaged in .build-pages/");
