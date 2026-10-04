# Storage and large text files

October 4, 2026 — included in the locally built [Windows 1.3.12 installer](../release/Scribly_1.3.12_x64-setup.exe). The public release remains 1.3.11; 1.3.12 has not been published.

## Decision

Remove the whole-notebook 20 MiB quota. Separate the amount stored from the amount decoded, rendered, highlighted, and rewritten during an interaction. Accept large text/code originals and show bounded sections instead of placing the entire file in a rich-text document.

This does not promise unlimited RAM, disk space, browser quota, or responsiveness for every possible document. Actual filesystem/database/browser limits still apply. Ordinary rich-text notes and boards are currently hydrated at startup; loading only their metadata is a further scaling improvement, not an implemented claim.

## Implemented behavior

- No combined application quota for notes, boards, archived items, and saved original text files.
- Text/code imports over 256 KiB become immutable original-file blocks with a read-only section viewer. Smaller imports retain the existing editable rich-text/code behavior.
- Import validates UTF-8 or BOM-marked UTF-16 using an incremental decoder. Binary or invalid text is rejected without adding a note.
- Desktop originals are copied into app-owned `sources` files in 1 MiB upload chunks. Browser originals are stored as IndexedDB Blobs. Import checks every byte but does not retain the decoded whole file or create a whole-file XML DOM.
- The viewer requests roughly 64 KiB per section, adds only enough bytes to complete boundary characters, and skips whole-file highlighting. Previous/Next and a section-number field allow navigation while requests are in flight. Stale results cannot replace a newer section.
- Source text stays selectable, with native horizontal/vertical scrolling. Lines can span sections; the original file's whitespace, encoding, and bytes remain unchanged. Download original returns that complete file.
- Write ordinary notes below the source viewer, and use the existing folder, archive, duplication, Reference, and backup workflows. Duplicate notes share an immutable original rather than copying its payload into rich text.
- Notebook search covers note text, titles, and original filenames. It does not scan every original file. Full-file search and direct large-file editing remain future work.

## Saving and recovery

Desktop PostgreSQL storage now uses `still_notes` rows plus revision/order metadata in `still_workspace`. Existing JSON notebooks migrate transactionally. Delta saves validate/write changed notes and read only IDs/folder references for unchanged items; they do not rewrite unrelated rich text or boards. Revision checks, atomic changes, and original-file validation remain in place.

The storage foundation introduced notebook format 4. Phase 2 now persists format 5 for history/Trash compatibility, while reading formats 2–4. Older builds must refuse these formats rather than treating the metadata-only row as an empty notebook. Export a portable backup before downgrading; do not open the migrated database directly with an older build. See [protection and recovery](protection-and-recovery.md).

Browser preview keeps the small existing localStorage path for compatibility. Larger notebooks, or notebooks that hit its quota, move to transactional per-item IndexedDB storage. The old copy is removed only after the new store acknowledges migration. Recovery journals similarly promote to IndexedDB when localStorage is full, preserving complete snapshot commits and immutable records.

Successfully migrated recovery records are removed from localStorage after the IndexedDB transaction commits, freeing room for preferences and preventing reclaimed records from reappearing on later promotion.

Original files are retained conservatively. Automatic cleanup of unreferenced originals and interrupted upload remnants is not included in this change; future cleanup must protect Undo, drafts, recovery conflicts, Trash, and history. Phase 2 protects historical image references and introduces bounded history/backup retention without limiting live storage.

## Backups and compatibility

- Notebooks without originals or format-5 deletion state can export portable JSON backups in format 2, including images. Trash uses format 5. Legacy JSON imports remain supported above the former 20 MiB limit.
- Notebooks with originals export `.scribly` file backups: stored ZIP entries containing a portable workspace manifest and the complete original files, without base64 expansion of those originals.
- Restore reads archive input in sections, validates manifest structure, required files, lengths, and CRC checksums, and remaps source IDs before adopting notes. Failed imports leave current notes intact; staged unreferenced files may remain for conservative cleanup.
- Large desktop exports use bounded upload chunks and a streamed atomic file copy rather than one enormous binary IPC argument. Existing destinations survive failed writes.
- The current file-backup implementation uses classic ZIP, so an entry/archive approaching 4 GiB needs separate original downloads. This is a backup-format limit, not a notebook storage quota. ZIP64/stream-to-destination backup support is a follow-up.
- Building a backup Blob can still use substantial browser/OS resources for a very large library. The viewer does not perform that work while opening or writing a note.

## Operation budgets that remain

These constrain conversion/rendering work independently of total storage:

| Operation | Current budget / behavior |
| --- | --- |
| Raw text/code import | No application file-size quota; over 256 KiB uses saved originals and section viewing |
| Individual raster image | 5 MiB and existing decoded-pixel validation |
| One drawing board | 20 MiB serialized rendering budget, 2,500 active elements, and existing geometry/label bounds |
| PDF/DOCX/Excalidraw/Mermaid conversion | 20 MiB input budget; PDFs retain the 500-page and extracted-text limits |
| Extracted prose from PDF/Word | Existing 2-million-character budget and DOCX expansion checks |
| Portable file backup | Classic ZIP entry/archive bounds; no artificial 20 MiB notebook quota |

Do not raise these budgets by changing a constant alone. A future large-file editor should have bounded rendering, incremental parsing/search, background indexing, explicit cancellation, and measured behavior on Windows WebView2. Read-only access plus original download is the initial safe path for large datasets.

## Validation and UI decisions

- A 25,160,014-byte XML fixture (about 24 MiB) imported in browser tests with no whole-file read: the largest read was 1 MiB, and the displayed section stayed below 66,000 characters. Exact original SHA-256 matched after download; notes and originals survived reload.
- UTF-8 code points and UTF-16 surrogate pairs round-trip across section boundaries without loss/duplication.
- A 24 MiB aggregate notebook migrated to IndexedDB, saved a small edit, and reloaded successfully. A large dirty draft promoted its recovery journal and restored after reopening it.
- File-backup tests restore originals with new IDs and reject same-size corruption.
- Production-preview UI checks export a `.scribly` backup from Settings, restore it in a fresh browser context, download byte-identical originals, and reload the restored viewer.
- Isolated PostgreSQL tests migrate a 24 MiB legacy notebook, preserve revision conflicts/failed updates, and verify an unchanged row's `xmin` does not change after a small delta save.
- An isolated Windows WebView2 development run imported the same 24 MiB XML, verified the on-disk original SHA-256, saved annotations, and reloaded them. Import took 17.7 seconds; next-section viewing took 133 ms. These are sample timings, not guaranteed limits; the native save dialog, RAM, and sustained frame rate were not measured.
- Viewer controls reuse theme tokens, Phosphor icons, existing control geometry, solid reading surfaces, keyboard controls, and native scrolling. No new gesture or animation controller was added. Buttons respond on press without delaying the click action.
- Wide light native, wide dark browser, and narrow browser screenshots were inspected. At the narrow window size, Reference retains the existing overlay behavior; use Focus or close Reference to give writing the full available width. The mechanical UI detector reported only the existing CSS accent-border warning at the earlier blockquote selector.

Build/test results and the isolated WebView2 report are recorded in the enhancement plan delivery log after final verification. The initial browser fixture timing covers import, navigation, download, reload, and screenshots together; it is not a typing latency, import-only benchmark, sustained frame-rate, or RAM measurement.

## Next scaling steps

1. Load note metadata at startup and hydrate only active/Reference bodies; add bounded caching and virtualization where measured note/folder counts justify it.
2. Add cancellable, streamed full-file search with result locations. Search raw text before attempting XML structure parsing.
3. Add large-file editing only after selecting and measuring an editor with bounded view rendering and incremental state updates; retain original download and safe atomic saves.
4. Add ZIP64/streaming-to-destination backups and safe original-file garbage collection, coordinated with the implemented history and Trash retention policies.

References: [Blob slicing](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice), [asynchronous IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), and [Tiptap integration performance guidance](https://tiptap.dev/docs/guides/performance). The chosen thresholds are application decisions, not promises from those APIs.
