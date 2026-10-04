import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
// Lockfile hashes cannot detect our pinned engine patch changing. Give changed
// patches a fresh optimizer cache instead of serving an older engine build.
const patchRevision = createHash("sha256").update(readFileSync(new URL("./scripts/patch-excalidraw.mjs", import.meta.url))).digest("hex").slice(0, 12);
export default defineConfig({
  cacheDir: `node_modules/.vite-notify-${version}-${patchRevision}`,
  plugins: [react()],
  // Pre-bundle lazy dependencies (including the code worker's imports) so
  // first use cannot restart the page and discard an open dialog/import.
  // This changes development preparation, not browser delivery.
  optimizeDeps: { include: ["@excalidraw/mermaid-to-excalidraw", "@excalidraw/excalidraw", "mermaid", "fflate", "pdfjs-dist/legacy/build/pdf.mjs", "lowlight",
    ...['plus', 'workflow', 'panel-left', 'book-open', 'target', 'settings', 'sun', 'moon', 'monitor', 'search', 'folder', 'folder-plus', 'file-text', 'archive', 'bold', 'italic', 'list', 'square-check', 'code', 'image', 'palette', 'undo', 'redo', 'highlighter', 'pencil', 'ellipsis', 'copy', 'download', 'upload', 'external-link', 'sliders-horizontal', 'chevron-down', 'chevron-right', 'chevron-up', 'x', 'zoom-in', 'align-left', 'align-center', 'align-right', 'arrow-up', 'arrow-down', 'list-plus'].map(name => `@animateicons/react/lucide/${name}-icon`),
    ...["javascript", "typescript", "rust", "python", "xml", "css", "json", "sql", "bash", "java", "c", "cpp", "csharp", "go", "yaml", "ini", "markdown"].map((name) => `highlight.js/lib/languages/${name}`)] },
  server: {
    port: 1420, strictPort: true,
    // Native build trees can contain thousands of files; they cannot affect
    // frontend hot reload and must not trigger scans or page reloads.
    watch: { ignored: ["**/.build-*/**", "**/src-tauri/**", "**/release/**", "**/test-results*/**"] },
  },
  clearScreen: false,
});
