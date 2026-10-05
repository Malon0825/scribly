# Scribly enhancement plan

Created: October 4, 2026. Baseline: repository version 1.3.11.

Purpose: make writing safer, retrieval faster, and everyday note workflows easier while preserving the existing notebook, Reference panel, and Windows conventions.

This roadmap tracks implemented work and remaining proposals. The storage foundation and Phases 2–6 protection, retrieval, connected-note, formatted-export and quick-capture features are included in the locally built Windows 1.3.16 installer; capacity reporting and further profiling remain open. The public release remains 1.3.11; the new installer has not been published. Phases are delivery milestones, not release dates.

## Tracking rules

- `[ ]` means work remains; `[x]` means completed with evidence.
- Phase status: Not started, In progress, Blocked, or Done.
- Mark a phase Done only after its implementation tasks and acceptance checks pass. Record the release/commit and validation evidence in `tests/verification.md`.
- Update this file after each delivered change. Record blockers and decisions instead of silently dropping tasks.
- Proposed defaults can be refined during implementation. `[NEEDS INPUT]` identifies unresolved product choices, not an implemented setting.

## Phase overview

| Phase | Outcome | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Confirm baseline and document gaps | Done (source review only) | None |
| 1 | Remove the storage quota and prepare safe storage | In progress | Phase 0 |
| 2 | Automatic backups, version history, and Trash | Done (local 1.3.12 installer; validation limitations below) | Phase 1 storage foundation |
| 3 | Find/replace, pins, and recent notes | Done (local 1.3.13 installer; validation limitations below) | Phase 2; can proceed independently once schema changes settle |
| 4 | Note links, backlinks, and reusable templates | Done (local 1.3.14 installer; validation limitations below) | Phases 1–2 |
| 5 | Formatted note export | Done (local 1.3.15 installer; validation limitations below) | Phase 1; can proceed independently of Phases 3–4 |
| 6 | Windows quick capture | Done (local 1.3.16 installer; validation limitations below) | Phases 1–2 |

## Phase 0 — Baseline and gap review

- [x] Inspect app shell, editor configuration, note model, search, persistence, recovery, and attachment capacity checks.
- [x] Confirm existing features: rich text, checklists, images, ink, code blocks, drawing boards, folder organization, search, archive/restore, Reference, Focus, manual backups, and import/export.
- [x] Distinguish crash recovery and editing Undo from user-accessible version history.
- [x] Confirm the current whole-notebook size limit and document its meaning below.
- [x] Record the enhancements in a phased checklist.

Evidence: [App](../src/App.tsx), [editor](../src/NoteEditor.tsx), [types](../src/types.ts), [workspace persistence](../src/useWorkspace.ts), [recovery](../src/recovery.ts), and [database](../src-tauri/src/database.rs). This milestone does not claim a runtime or native UI audit.

## Previous 20 MB limit (baseline 1.3.11)

**Update:** the overall notebook limit has been removed in the 1.3.12 source implementation. The explanation below records the previous behavior; it does not describe the new storage policy. See [storage and large files](storage-and-large-files.md) for implemented behavior, operation budgets, compatibility, and verification limits.

The baseline code enforced `20 * 1024 * 1024` bytes: **20 MiB (20,971,520 bytes)**, although the UI called it “20 MB.” It limited the complete current notebook's serialized content budget, checked during updates and saves.

- It is **not a lifetime allowance**. Repeated saves replace the current notebook state; they do not consume a cumulative quota.
- It is **not 20 MiB per note or per folder**. All notes, boards, folder metadata, and archived items share the current notebook budget.
- Desktop note images live in separate attachment files, but capacity accounting adds their equivalent embedded/base64 size. Repeated image occurrences count toward that portable budget even when the disk file is shared. Board image data is also included in the serialized board payload.
- HTML/JSON structure and image encoding overhead count. The limit does not mean users can attach exactly 20 MiB of raw image files.
- Archiving does not free capacity because archived items remain in the notebook. Removing content or permanently deleting items reduces the current content budget; exporting a backup alone does not reduce it.
- Example: a notebook using 12 MiB can be saved thousands of times without exhausting an allowance. Adding another 9 MiB of counted content would exceed the cap.
- This is not a measurement of the PostgreSQL directory, logs, recovery records, or total disk usage. Those can occupy additional space. Browser storage and recovery storage have separate quotas and may fail before this application limit is reached.
- Separate input limits also exist: imported files up to 20 MiB each, and individual raster images up to 5 MiB. Passing an individual file check does not guarantee the resulting notebook fits.

Evidence: [limit constant](../src/boardData.ts), the retired whole-workspace calculator (historical evidence in [verification history](../tests/verification.md)), [attachment accounting](../src/attachments.ts), [Rust workspace validation](../src-tauri/src/workspace.rs), and [Rust image accounting](../src-tauri/src/attachments.rs).

## Phase 1 — Capacity and storage foundation

Goal: make capacity understandable and establish storage that can safely support retained versions and deleted items.

- [ ] **CAP-01:** Add a Settings storage summary that distinguishes current notes/originals, attachment disk usage, and later history/backup usage. Explain whether archived and deleted items count; do not present a total application quota.
- [x] **CAP-02:** Remove total-quota checks and expensive whole-notebook capacity validation from typing/import paths. Retain truthful save/disk/quota errors and specific per-operation budgets; no total-quota warning is needed.
- [ ] **CAP-03:** Measure load, typing, save, recovery, export, and restore behavior with larger text/image/board notebooks in browser preview and Windows WebView2.
- [x] **CAP-04:** Remove the overall quota; use per-item PostgreSQL storage and file-backed large text originals. Document what is measured and what remains eager at startup.
- [x] **CAP-05:** Separate current operation budgets from notebook capacity; support portable JSON and original-inclusive file backups. History budgets remain part of Phase 2.
- [x] **CAP-06:** Define schema migration and attachment retention for current items, archived items, Trash, historical versions, and recovery conflicts. Format 5 and history-aware image retention are implemented; original cleanup remains conservative. See [protection and recovery](protection-and-recovery.md).
- [x] **CAP-07:** Add IndexedDB for larger browser notebooks, original-file Blobs, and recovery-journal promotion. Browser/OS quota failures stay visible; future history must use the same durable storage principles.
- [x] **CAP-08:** Accept large text/code imports as immutable originals with bounded section viewing, Unicode-safe boundaries, complete original download, and ordinary editable annotations. Full-file editing/search remains a follow-up.

Acceptance checks:

- [x] Verify notebooks/originals over 20 MiB save and reload without a total-quota error; unchanged desktop note rows are not rewritten by a small edit.
- [x] Verify Unicode section boundaries, intact original download, retained per-operation checks, and original-inclusive backup restoration.
- [x] Migration, failed-update/revision-conflict, and recovery tests preserve notebook data. Record final native UI verification separately below.
- [x] Capacity documentation states tested limits and browser/native differences.

Storage decision: no application quota on overall notebook storage. Operating-system/browser limits still apply, and individual conversion/rendering budgets remain. Phase 2 defines separate retention budgets below. CAP-01 usage reporting and further profiling in CAP-03 remain open; Phase 1 is not marked Done. Those reporting/profiling tasks do not block the implemented protection features.

## Phase 2 — Recovery, backups, and reversible deletion

Goal: protect users from accidental edits, deletion, and loss of the primary notebook.

### 2A. Automatic backups

- [x] **BACKUP-01:** Opt-in Windows destination and daily schedule while open; catch up on launch when the saved revision changed. Browser copies use IndexedDB and disclose their device-local scope.
- [x] **BACKUP-02:** Portable consistent snapshots include attachments and originals; synced atomic native writes and browser transactions preserve previous successful copies on failure.
- [x] **BACKUP-03:** Settings shows destination, last successful backup, Backup now, and errors separately from notebook save status.
- [x] **BACKUP-04:** Retain seven ordinary copies and three copies made before replacement. Restore preview offers import-as-new or acknowledged replacement; a failed protective copy stops replacement.
- [x] **BACKUP-05:** Include notes, boards, images, ink, originals, folders, Archive, and Trash. Local version history is excluded and explicitly disclosed. Reusable note templates and their assets are included as of Phase 4.

Acceptance: [x] Fresh browser restore preserves rich text/images/ink; existing board and original-inclusive round trips pass. Native isolated-profile replacement preserves originals and Trash. Unavailable destinations and simulated full-disk atomic-writer failures retain prior copies; cancellation, same-size corruption, and legacy backups are covered. Interactive native folder/save pickers and a physically full drive remain untested release checks.

### 2B. Note and board version history

- [x] **HISTORY-01:** Outgoing title/content/board checkpoints live separately in PostgreSQL or IndexedDB, with stable item IDs and protected image references.
- [x] **HISTORY-02:** Dated read-only viewer lazily loads one note/board preview and offers Restore this version.
- [x] **HISTORY-03:** Checkpoint the current saved body before restoring; preserve today's organization and all later retained versions.
- [x] **HISTORY-04:** Automatic checkpoints at least five minutes apart; up to 20 versions/item, 30 days, shared 64 MiB payload budget. Failed mandatory checkpoints stop restore. Oversized history bodies never limit live notebook capacity.
- [x] **HISTORY-05:** Both desktop and browser history survive restart. Browser metadata is indexed by item; bodies load separately.

Acceptance: [x] Earlier rich text/images/ink restore through reload; changed board content restores through persistence. Retention/purge and historical image references pass browser/PostgreSQL checks. Failed checkpoints and stale revisions preserve current content; native history survives webview reload.

### 2C. Trash

- [x] **TRASH-01:** Move to Trash retains complete notes/boards with deletion timestamps; Archive remains distinct.
- [x] **TRASH-02:** Trash list, read-only viewing, Restore, and immediate Undo; original-folder restore or Unfiled fallback.
- [x] **TRASH-03:** Exclude Trash from ordinary navigation/search, Copy last note, weekly aggregation, dragging, and Reference; safely reselect the active item.
- [x] **TRASH-04:** Confirm permanent deletion and Empty Trash; no automatic expiry. Show serialized Trash body usage and disclose additional original/attachment files.
- [x] **TRASH-05:** Folder removal returns affected items to Unfiled; Trash retains local history, permanent purge removes it. Image retention protects recoverable drafts/history; originals remain conservatively retained.

Acceptance: [x] Active/reference and inactive deletion, Undo, folder removal/restart, editable restoration, Archive separation, Cancel/Escape, and confirmed history purge pass. Conservative file retention is documented rather than promising immediate disk reclamation.

Phase exit: [x] Backup, historical, and Trash restoration pass in browser and isolated Windows WebView2. Retention, migration, backup scope, native/browser differences, and untested release checks are documented in [protection and recovery](protection-and-recovery.md).

## Phase 3 — Faster retrieval and editing

### 3A. Find and replace

- [x] **SEARCH-01:** Add in-note Find with Ctrl+F, match count, highlighting, next/previous, and Escape to dismiss without losing the editing position.
- [x] **SEARCH-02:** Add Replace with Ctrl+H, single/all replacement, case-sensitive and whole-word options, and meaningful Undo. Keep Reference and archived content read-only.
- [x] **SEARCH-03:** Improve existing notebook search with matching excerpts and navigation to the match. Preserve searches across ordinary navigation where useful.
- [x] **SEARCH-04:** Define searchable board content separately; start with text/labels. Do not imply rich-text replacement applies to every canvas element.

Acceptance: [x] Verify Unicode, text across formatting marks, code blocks, empty queries, image/ink preservation, keyboard navigation, and responsive typing in larger notes. Counting/navigation covers every match; painted highlights are bounded to 1,000 nearby matches. Original-file contents remain immutable and excluded, with an explicit hint.

### 3B. Pinned and recent notes

- [x] **NAV-01:** Add persisted pin/unpin for notes and boards, with a compact sidebar section and keyboard-accessible actions.
- [x] **NAV-02:** Add a bounded Recently opened list independent of modification timestamps and existing folder order.
- [x] **NAV-03:** Specify how archive, Trash, permanent deletion, and restoration affect these lists. Preserve editor selection and Reference behavior when navigating.

Acceptance: [x] Pins survive browser reload and native database restart; recent order reflects opening, not autosave; unavailable items do not leave broken navigation entries. [Behavior and compatibility](retrieval-and-editing.md).

Phase exit: [x] Find/replace and pin/recent navigation pass interaction checks without remounting or modifying the note unnecessarily. Browser and optimized Windows WebView2 checks pass, including replacement Undo/Redo, persisted navigation and immutable original bytes. [Usage and limits](retrieval-and-editing.md), [release evidence](../tests/verification.md).

## Phase 4 — Connected notes and reusable workflows

### 4A. Note links and backlinks

- [x] **LINK-01:** Add an internal item-link picker using stable IDs, for both notes and boards. Offer Open and Open in Reference.
- [x] **LINK-02:** Show backlinks from other items. Derive or index them from actual links so renames and moves do not break connections.
- [x] **LINK-03:** Define missing/archived/deleted target behavior and safe external link handling. Keep link interaction from interfering with text selection.
- [x] **LINK-04:** Remap internal IDs during backup import/duplication where required; define how links behave in exported Markdown/PDF. Phase 5 implements links within exported batches and retains IDs for targets outside the batch.

Acceptance: [x] Verify rename/move, Trash/restore, missing targets, imported links, keyboard activation, and Reference opening without stealing editor focus.

### 4B. Reusable note templates

- [x] **TPL-01:** Save a note as a named template; create independent notes from a template with formatting, images, and checklists preserved.
- [x] **TPL-02:** Manage templates and folder defaults while preserving the existing Copy last note workflow. A configured template takes priority; None falls back to Copy last note.
- [x] **TPL-03:** Offer optional checklist reset and simple title/date fields for meeting notes, daily logs, and project notes. Keep board templates distinct.
- [x] **TPL-04:** Include templates in backup/import and attachment retention, with capacity accounting consistent with Phase 1.

Acceptance: [x] New notes never share mutable content with templates; checklist reset is optional; template images survive source-note deletion and backup restore.

Phase exit: [x] Links remain stable across normal organization changes and templates generate independently editable notes. Browser checks and the optimized Windows WebView2 template/link/backup workflow pass. Template-containing notebooks require 1.3.14 or newer. Native pickers and external system-browser launch remain unexercised. [Usage and compatibility](connected-notes-and-templates.md), [verification](../tests/verification.md).

## Phase 5 — Formatted note export

- [x] **EXPORT-01:** Add print/PDF output for notes with headings, lists, checklists, code, images, captions, and sensible page breaks. Standalone HTML and native print handoff are available; saving a PDF remains controlled by the system dialog.
- [x] **EXPORT-02:** Add Markdown export with image sidecars or a portable archive; preserve code fences and task states. ZIP archives deduplicate raster assets.
- [x] **EXPORT-03:** Define supported representation for ink strokes, semantic colors, and internal links. The preview discloses omitted ink, Markdown color/underline loss and metadata-only originals; exported batch links resolve within the output.
- [x] **EXPORT-04:** Support selected-note and folder/batch export with safe names and cancellation. Existing plain-text, board, and JSON backup exports remain available.
- [x] **EXPORT-05:** Use a consistent current draft snapshot; verify native save dialogs and browser downloads separately. Native HTML Save produced matching bytes; browser ZIP/HTML downloads passed. Per-operation export limits do not cap notebook storage.

Acceptance: [x] Inspect actual Markdown/HTML and a multi-page Chromium PDF; verify Unicode fixtures, long code lines, images, page breaks, light/dark dialogs, current unsaved edits, cancellation and failure recovery. Optimized Windows WebView2 verified native assets, HTML Save, print preview/cancellation and unchanged notebook state. Native ZIP picker writes and actual native PDF saving remain unexercised; comprehensive glyph/image pagination and memory profiling remain open.

Phase exit: [x] Notes can be shared in readable formatted output, with unsupported fidelity clearly documented. [Usage and limits](formatted-note-export.md), [verification](../tests/verification.md).

## Phase 6 — Windows quick capture

- [x] **CAPTURE-01:** Add an opt-in configurable global shortcut that opens a small quick-capture window while the app is running.
- [x] **CAPTURE-02:** Save captures into an Inbox folder through the same persistence/recovery pipeline; serialize writes and retain revision conflict protection across windows.
- [x] **CAPTURE-03:** Add Save, Open in notebook, and Escape behavior that preserves unsaved drafts. Show a saved result only after persistence succeeds.
- [x] **CAPTURE-04:** Handle shortcut conflicts, restart registration, window cleanup, keyboard focus, and accessible controls. Define how it cooperates with existing Windows startup settings.
- [x] **CAPTURE-05:** Provide an in-app capture action in browser preview and clearly label the desktop-only global shortcut.

Acceptance: [x] Test capturing from another Windows application, repeated shortcut presses, main-window/capture edits together, save failure, cancellation, and restart recovery without overwriting newer data.

Phase exit: [x] Desktop quick capture is reliable and interruptible; browser limitations are explicit. [Usage and limits](quick-capture.md), [verification history](../tests/verification.md).

## Definition of Done for each delivered change

- [ ] Complete the feature's acceptance checks and record reproducible evidence.
- [ ] Preserve editor focus/selection, scrolling, Reference read-only behavior, autosave, recovery, and truthful error feedback.
- [ ] Follow [AGENTS.md](../AGENTS.md): current theme tokens, Windows controls, restrained materials, keyboard access, and reduced-motion/transparency support. Use its A–F review format only for substantial UI/motion changes.
- [ ] Validate light/dark/System appearance, narrow/wide windows, Focus, and maximized geometry for affected UI.
- [ ] Run `npm run build` for frontend changes. Use targeted behavioral checks only when needed for a changed persistence/migration boundary, uncertain behavior, or a known failure. Avoid broad reruns once relevant evidence is sufficient; record any untested behavior. Run appropriate Rust checks for backend changes.
- [ ] Test the browser and native WebView2 where available; explicitly record untested native behavior.
- [ ] Update user-facing documentation, migration notes, backup compatibility, and this checklist. Documentation-only updates require content review, not an app build.

## Blockers and decisions

| Date | Item | Status / decision | Impact |
| --- | --- | --- | --- |
| 2026-10-04 | Larger capacity | Overall quota removed; per-item saves and bounded original-file viewing implemented | Further lazy body loading/profiling remains; no unlimited-performance claim |
| 2026-10-04 | History and backup retention | History: 20/item, 30 days, shared 64 MiB; five-minute automatic checkpoints. Backups: seven ordinary plus three safety copies | Separate from live storage; backup history exclusion is visible |
| 2026-10-04 | Trash expiry | Manual permanent deletion only, with confirmation | Trash uses storage; original cleanup stays conservative |
| 2026-10-04 | Template compatibility | Separate template item records require Scribly 1.3.14 or newer; folder defaults prefer templates over Copy last note | Backups retain template assets and remap imported links; do not downgrade template-containing notebooks |

## Delivery evidence

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
