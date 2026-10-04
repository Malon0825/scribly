# Formatted note export

Use **Note options → Export formatted…** for the current note, or **Folder options → Export notes…** for a folder. The dialog previews a frozen snapshot taken when it opens, including title and editor changes that have not yet autosaved. Close and reopen it to capture a newer draft. Exporting preserves the active editor and autosave.

Choose **Export Markdown (.zip)** for Markdown files with image sidecars, **Save HTML** for a standalone reading document, or **Print / Save as PDF** to open the system print dialog. Browser preview downloads files; the desktop app uses Save dialogs. Folder exports include live ordinary notes, excluding boards, templates, Archive and Trash. Plain-text notes, portable drawings and notebook backups retain their existing export actions.

Markdown preserves headings, emphasis, lists, task states, code fences and image captions. Raster images use local sidecars; repeated image bytes share one asset within the archive. Batch filenames are Windows-safe and case-insensitively unique. HTML embeds raster images and uses a light reading layout regardless of the app theme. Its print styles wrap long code lines, keep images within the page, and start each batch note on a new page. Reader pagination can differ.

The dialog discloses these format differences before export:

- Ink and freehand highlights are omitted from HTML, PDF and Markdown. Notebook backups retain them.
- HTML/PDF preserve semantic text and background colors with a readable light palette. Markdown omits colors, underline and exact page layout.
- Internal links point to another exported note where that target is in the batch: HTML uses document anchors and Markdown uses the corresponding filename. Other internal links become text with the item ID. IDs are retained for identification rather than promising access to another installation's notebook.
- Original-file blocks include filename, byte size and encoding only. Download the original separately or use a notebook backup to retain its contents.

Preparation errors remain visible with **Retry preparation**. Cancel or Escape aborts preparation without exporting. Native Save cancellation reports cancellation rather than success. Browser success reports that a download was initiated. Printing only reports the handoff to the system dialog; Scribly cannot confirm whether paper or a PDF was saved. If the embedded print handoff is unavailable, save HTML and print it from a browser.

One export is bounded to 1,000 notes, 24 MiB of estimated input strings, 32 MiB of unique raster assets, and 96 MiB of estimated output; individual note content is limited to 12 MiB of characters. Images retain their existing 5 MiB / 25 million pixel validation. Complex documents also have structural safety limits. Export fewer notes when these limits are reached. These are working-memory limits for an export operation, not notebook capacity limits.

## Verification boundaries

Five focused browser checks passed across targeted runs: actual current-draft Markdown ZIP contents; unique safe folder names and deduplicated images; sanitized standalone HTML and a real multi-page Chromium PDF with extracted text; dialog dismissal without editor replacement and download failure/retry; and visible fidelity disclosures in narrow light and wide dark dialogs. Direct sanitizer checks use raw unsafe HTML, and an already-aborted preparation rejects with `AbortError`.

The final HTML/PDF and disclosure checks passed again after the export material/layout corrections, including a long code-line fixture; only those two affected checks were repeated. The initial development-server interruption required rerunning failed checks only. Fixture corrections supplied the required schema version for source-file blocks and used the installed PDF loading-task cleanup API. The narrow dialog capture closes Reference with its existing toggle because the two-panel layout overlaps the note-options trigger at 850px; that app-shell geometry is outside this export change.

Evidence is saved in `release/phase5-export-evidence` (actual ZIP, HTML and PDF), `release/phase5-export-checks.log`, `release/phase5-export-final.log`, and `.impeccable/review/phase5-export-{narrow-light,wide-dark}.png`.

The packaged 1.3.15 Windows app passed an isolated WebView2 workflow: real attachment storage/read, HTML/ZIP formatting, captured Save cancellation, native print preview/cancellation and iframe cleanup, and actual native HTML Save with matching SHA-256. Exporting left the saved notebook document and revision unchanged. ZIP picker-bound bytes were captured at the IPC handoff; its actual Save dialog was not completed. Native PDF saving was not exercised; Chromium PDF generation verifies printable content. Select the desired printer/PDF destination and paper size in the system dialog. Full Unicode glyph coverage, large-image pagination and sustained export memory profiling remain unmeasured. [Native report](../release/formatted-webview-test-cbb004fbccf24e07842429b6bc88ab9c/formatted.json), [release audit](../release/build-1.3.15-20261004-190839/verification.json).

