# Scribly enhancement plan

Created: October 4, 2026. Baseline: repository version 1.3.11.

Purpose: make writing safer, retrieval faster, and everyday note workflows easier while preserving the existing notebook, Reference panel, and Windows conventions.

This is a proposed roadmap. Only the source inspection and planning work is complete; none of the enhancements below has been implemented by creating this document. Phases are delivery milestones, not release dates.

## Tracking rules

- `[ ]` means work remains; `[x]` means completed with evidence.
- Phase status: Not started, In progress, Blocked, or Done.
- Mark a phase Done only after its implementation tasks and acceptance checks pass. Record the release/commit and validation evidence in the delivery log.
- Update this file after each delivered change. Record blockers and decisions instead of silently dropping tasks.
- Proposed defaults can be refined during implementation. `[NEEDS INPUT]` identifies unresolved product choices, not an implemented setting.

## Phase overview

| Phase | Outcome | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Confirm baseline and document gaps | Done (source review only) | None |
| 1 | Define capacity and prepare safe storage | Not started | Phase 0 |
| 2 | Automatic backups, version history, and Trash | Not started | Phase 1 |
| 3 | Find/replace, pins, and recent notes | Not started | Phase 2; can proceed independently once schema changes settle |
| 4 | Note links, backlinks, and reusable templates | Not started | Phases 1–2 |
| 5 | Formatted note export | Not started | Phase 1; can proceed independently of Phases 3–4 |
| 6 | Windows quick capture | Not started | Phases 1–2 |

## Phase 0 — Baseline and gap review

- [x] Inspect app shell, editor configuration, note model, search, persistence, recovery, and attachment capacity checks.
- [x] Confirm existing features: rich text, checklists, images, ink, code blocks, drawing boards, folder organization, search, archive/restore, Reference, Focus, manual backups, and import/export.
- [x] Distinguish crash recovery and editing Undo from user-accessible version history.
- [x] Confirm the current whole-notebook size limit and document its meaning below.
- [x] Record the enhancements in a phased checklist.

Evidence: [App](../src/App.tsx), [editor](../src/NoteEditor.tsx), [types](../src/types.ts), [workspace persistence](../src/useWorkspace.ts), [recovery](../src/recovery.ts), and [database](../src-tauri/src/database.rs). This milestone does not claim a runtime or native UI audit.

## What the 20 MB limit actually means

The code enforces `20 * 1024 * 1024` bytes: **20 MiB (20,971,520 bytes)**, although the UI calls it “20 MB.” It is a limit on the complete current notebook's serialized content budget, checked during updates and saves.

- It is **not a lifetime allowance**. Repeated saves replace the current notebook state; they do not consume a cumulative quota.
- It is **not 20 MiB per note or per folder**. All notes, boards, folder metadata, and archived items share the current notebook budget.
- Desktop note images live in separate attachment files, but capacity accounting adds their equivalent embedded/base64 size. Repeated image occurrences count toward that portable budget even when the disk file is shared. Board image data is also included in the serialized board payload.
- HTML/JSON structure and image encoding overhead count. The limit does not mean users can attach exactly 20 MiB of raw image files.
- Archiving does not free capacity because archived items remain in the notebook. Removing content or permanently deleting items reduces the current content budget; exporting a backup alone does not reduce it.
- Example: a notebook using 12 MiB can be saved thousands of times without exhausting an allowance. Adding another 9 MiB of counted content would exceed the cap.
- This is not a measurement of the PostgreSQL directory, logs, recovery records, or total disk usage. Those can occupy additional space. Browser storage and recovery storage have separate quotas and may fail before this application limit is reached.
- Separate input limits also exist: imported files up to 20 MiB each, and individual raster images up to 5 MiB. Passing an individual file check does not guarantee the resulting notebook fits.

Evidence: [limit constant](../src/boardData.ts), [whole-workspace calculation](../src/workspaceSize.ts), [attachment accounting](../src/attachments.ts), [Rust workspace validation](../src-tauri/src/workspace.rs), and [Rust image accounting](../src-tauri/src/attachments.rs).

## Phase 1 — Capacity and storage foundation

Goal: make capacity understandable and establish storage that can safely support retained versions and deleted items.

- [ ] **CAP-01:** Add a Settings capacity summary that distinguishes the current notebook budget, attachment disk usage, and later history/backup usage. Explain whether archived and deleted items count.
- [ ] **CAP-02:** Show a useful near-limit warning and actionable limit errors without interrupting typing or falsely reporting a successful save.
- [ ] **CAP-03:** Measure load, typing, save, recovery, export, and restore behavior with larger text/image/board notebooks in browser preview and Windows WebView2.
- [ ] **CAP-04:** Decide whether to raise the cap, move to separate item records, or use staged changes. Document measured limits; do not just increase one constant.
- [ ] **CAP-05:** Separate notebook, per-file, backup, and history limits. Keep TypeScript/Rust validation, import/export, and error messages consistent; ensure newly exported backups can be restored.
- [ ] **CAP-06:** Define schema migration and attachment retention for current items, archived items, Trash, historical versions, and recovery conflicts. Never prune files needed by a retained version.
- [ ] **CAP-07:** Define safe browser behavior for larger notebooks and history: evaluate durable browser storage if localStorage is insufficient, or explicitly document a smaller supported preview capacity.

Acceptance checks:

- [ ] Repeated saves do not increase the reported current notebook usage simply because another save occurred.
- [ ] Boundary checks agree across frontend/backend, including Unicode, shared images, and archived items.
- [ ] Migration and interrupted-save tests preserve the old notebook and attachments; conflict detection remains effective.
- [ ] Capacity documentation states tested limits and browser/native differences.

Decision pending: [NEEDS INPUT] the supported larger capacity and default retention budgets. Choose these after measurements; this plan does not promise unlimited storage.

## Phase 2 — Recovery, backups, and reversible deletion

Goal: protect users from accidental edits, deletion, and loss of the primary notebook.

### 2A. Automatic backups

- [ ] **BACKUP-01:** Add an opt-in backup destination and schedule. Proposed starting point: one daily backup when the app is running and the notebook has changed; catch up on next launch rather than adding an always-running service.
- [ ] **BACKUP-02:** Write a consistent, portable notebook snapshot with all required attachments using atomic file replacement. Keep previous successful backups when a new write fails.
- [ ] **BACKUP-03:** Show last successful backup, Backup now, destination, and actionable errors. Distinguish database save status from backup status.
- [ ] **BACKUP-04:** Add bounded retention and a restore preview. Support both importing as new items and explicitly replacing the notebook; protect the current notebook before replacement.
- [ ] **BACKUP-05:** Define whether backups include Trash, templates, and version history, and make that scope visible. Restore must not silently discard supported data.

Acceptance: [ ] Restore notes, boards, images, ink, and metadata on a fresh installation; test unavailable destinations, disk-full failures, cancellation, corrupt files, and old backup compatibility.

### 2B. Note and board version history

- [ ] **HISTORY-01:** Store retained versions outside the live workspace payload with stable item IDs and attachment references. Capture meaningful changes with bounded retention, not a full version for every keystroke.
- [ ] **HISTORY-02:** Add a dated read-only history viewer with note/board previews and Restore this version.
- [ ] **HISTORY-03:** Preserve the current content as a version before restoring older content. Restoration creates a new current state rather than erasing later history.
- [ ] **HISTORY-04:** Define checkpoint frequency, age/count/byte budgets, and behavior when history cannot be written. Keep editing/save/history status truthful.
- [ ] **HISTORY-05:** Provide browser persistence or clearly identified preview limitations; history must survive restart where supported.

Acceptance: [ ] Restore earlier rich text, images, ink, and board states after restart; verify retention cleanup never removes referenced files and a failed restore leaves current content intact.

### 2C. Trash

- [ ] **TRASH-01:** Make ordinary Delete move notes/boards into Trash with a deletion timestamp. Keep Archive as a separate workflow.
- [ ] **TRASH-02:** Add Trash list, Restore, and immediate Undo. Restore the original folder when available; otherwise use Unfiled notes.
- [ ] **TRASH-03:** Exclude deleted items from ordinary navigation, search, templates, and Reference selection. Safely choose a new active/reference item when needed.
- [ ] **TRASH-04:** Retain confirmation for Delete permanently and Empty Trash. Proposed initial policy: no automatic permanent deletion; show Trash usage so retention is explicit.
- [ ] **TRASH-05:** Define folder deletion and historical-version behavior for trashed/permanently deleted items. Count retained content honestly rather than presenting Trash as freed disk space.

Acceptance: [ ] Test deleting active/reference items, restoring after folder removal and restart, cancelling permanent deletion, and attachment/history cleanup after a confirmed purge.

Phase exit: [ ] Backup restore, historical restore, and Trash restore all pass; retention policies and native/browser limits are documented.

## Phase 3 — Faster retrieval and editing

### 3A. Find and replace

- [ ] **SEARCH-01:** Add in-note Find with Ctrl+F, match count, highlighting, next/previous, and Escape to dismiss without losing the editing position.
- [ ] **SEARCH-02:** Add Replace with Ctrl+H, single/all replacement, case-sensitive and whole-word options, and meaningful Undo. Keep Reference and archived content read-only.
- [ ] **SEARCH-03:** Improve existing notebook search with matching excerpts and navigation to the match. Preserve searches across ordinary navigation where useful.
- [ ] **SEARCH-04:** Define searchable board content separately; start with text/labels. Do not imply rich-text replacement applies to every canvas element.

Acceptance: [ ] Verify Unicode, text across formatting marks, code blocks, empty queries, image/ink preservation, keyboard navigation, and responsive typing in larger notes.

### 3B. Pinned and recent notes

- [ ] **NAV-01:** Add persisted pin/unpin for notes and boards, with a compact sidebar section and keyboard-accessible actions.
- [ ] **NAV-02:** Add a bounded Recently opened list independent of modification timestamps and existing folder order.
- [ ] **NAV-03:** Specify how archive, Trash, permanent deletion, and restoration affect these lists. Preserve editor selection and Reference behavior when navigating.

Acceptance: [ ] Pins survive restart; recent order reflects opening, not autosave; unavailable items do not leave broken navigation entries.

Phase exit: [ ] Find/replace and pin/recent navigation pass interaction checks without remounting or modifying the note unnecessarily.

## Phase 4 — Connected notes and reusable workflows

### 4A. Note links and backlinks

- [ ] **LINK-01:** Add an internal item-link picker using stable IDs, for both notes and boards. Offer Open and Open in Reference.
- [ ] **LINK-02:** Show backlinks from other items. Derive or index them from actual links so renames and moves do not break connections.
- [ ] **LINK-03:** Define missing/archived/deleted target behavior and safe external link handling. Keep link interaction from interfering with text selection.
- [ ] **LINK-04:** Remap internal IDs during backup import/duplication where required; define how links behave in exported Markdown/PDF.

Acceptance: [ ] Verify rename/move, Trash/restore, missing targets, imported links, keyboard activation, and Reference opening without stealing editor focus.

### 4B. Reusable note templates

- [ ] **TPL-01:** Save a note as a named template; create independent notes from a template with formatting, images, and checklists preserved.
- [ ] **TPL-02:** Manage templates and folder defaults while preserving the existing Copy last note workflow. Explicitly define precedence when both are configured.
- [ ] **TPL-03:** Offer optional checklist reset and simple title/date fields for meeting notes, daily logs, and project notes. Keep board templates distinct.
- [ ] **TPL-04:** Include templates in backup/import and attachment retention, with capacity accounting consistent with Phase 1.

Acceptance: [ ] New notes never share mutable content with templates; checklist reset is optional; template images survive source-note deletion and backup restore.

Phase exit: [ ] Links remain stable across normal organization changes and templates generate independently editable notes.

## Phase 5 — Formatted note export

- [ ] **EXPORT-01:** Add print/PDF output for notes with headings, lists, checklists, code, images, captions, and sensible page breaks.
- [ ] **EXPORT-02:** Add Markdown export with image sidecars or a portable archive; preserve code fences and task states.
- [ ] **EXPORT-03:** Define supported representation for ink strokes, semantic colors, and internal links. Preview or disclose formatting loss before export where relevant.
- [ ] **EXPORT-04:** Support selected-note and folder/batch export with safe names and cancellation. Preserve existing plain-text, board, and JSON backup exports.
- [ ] **EXPORT-05:** Use a consistent current draft snapshot; verify native save dialogs and browser downloads separately. Format limits must not invalidate Phase 1's capacity decisions.

Acceptance: [ ] Inspect exported files in another reader; verify Unicode, long code lines, images, page breaks, light/dark readability, current unsaved edits, cancellation, and export failures.

Phase exit: [ ] Notes can be shared in readable formatted output, with unsupported fidelity clearly documented.

## Phase 6 — Windows quick capture

- [ ] **CAPTURE-01:** Add an opt-in configurable global shortcut that opens a small quick-capture window while the app is running.
- [ ] **CAPTURE-02:** Save captures into an Inbox folder through the same persistence/recovery pipeline; serialize writes and retain revision conflict protection across windows.
- [ ] **CAPTURE-03:** Add Save, Open in notebook, and Escape behavior that preserves unsaved drafts. Show a saved result only after persistence succeeds.
- [ ] **CAPTURE-04:** Handle shortcut conflicts, restart registration, window cleanup, keyboard focus, and accessible controls. Define how it cooperates with existing Windows startup settings.
- [ ] **CAPTURE-05:** Provide an in-app capture action in browser preview and clearly label the desktop-only global shortcut.

Acceptance: [ ] Test capturing from another Windows application, repeated shortcut presses, main-window/capture edits together, save failure, cancellation, and restart recovery without overwriting newer data.

Phase exit: [ ] Desktop quick capture is reliable and interruptible; browser limitations are explicit.

## Definition of Done for each delivered change

- [ ] Complete the feature's acceptance checks and record reproducible evidence.
- [ ] Preserve editor focus/selection, scrolling, Reference read-only behavior, autosave, recovery, and truthful error feedback.
- [ ] Follow [AGENTS.md](../AGENTS.md): current theme tokens, Windows controls, restrained materials, keyboard access, and reduced-motion/transparency support. Use its A–F review format only for substantial UI/motion changes.
- [ ] Validate light/dark/System appearance, narrow/wide windows, Focus, and maximized geometry for affected UI.
- [ ] Run `npm run build` for frontend changes. Inspect available tests and run relevant behavioral tests; add tests for persistence/migration and other meaningful new risks. Run Rust checks for backend changes.
- [ ] Test the browser and native WebView2 where available; explicitly record untested native behavior.
- [ ] Update user-facing documentation, migration notes, backup compatibility, and this checklist. Documentation-only updates require content review, not an app build.

## Blockers and decisions

| Date | Item | Status / decision | Impact |
| --- | --- | --- | --- |
| 2026-10-04 | Larger capacity | Pending measurement; no new cap selected | Phase 1 must determine supported limits before expanding storage |
| 2026-10-04 | History and backup retention | Proposed bounded retention; exact budgets pending | Phase 2 must define cleanup and disk use |
| 2026-10-04 | Trash expiry | Proposed manual emptying initially | Automatic permanent deletion is outside the initial proposal |

## Delivery log

| Date | Phase / task IDs | Result | Release / commit | Validation evidence |
| --- | --- | --- | --- | --- |
| 2026-10-04 | Phase 0 | Source review and roadmap complete; enhancements remain unimplemented | Baseline 1.3.11 | Source links above; no runtime verification |

Future entries should state what shipped, remaining limitations, and the checks performed. Cloud sync, collaboration, tags, and AI features are outside this roadmap; revisit them after the core notebook workflows are dependable.
