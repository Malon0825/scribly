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

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
