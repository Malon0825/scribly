# Safety, transfer, resizing and native-window evidence

Source inspection only, 2026-10-04. Read project AGENTS.md and the complete attached brief. PASS below means the stated implementation is proven by code; it does not mean a browser, Narrator, filesystem-failure or Tauri test ran. All runtime/native outcomes are NOT VERIFIED in this subtask. No app files changed.

## Findings

**[G-01] Major — Structure changes have no Undo path**
- Where: sidebar transfers, folder rename/removal and permanent note deletion; all themes/sizes.
- Trigger/state: move a note with drag or Alt+Shift+Arrow; rename/remove a folder; confirm Delete permanently.
- Observed: transfer commits directly through workspace update (`src/useSidebarDrag.ts:44`, `:48`, `:65`); folder removal and note deletion commit directly (`src/App.tsx:1536`, `:1548`). The app update wrapper only calls mutate and handles errors (`src/App.tsx:215`). Note Undo calls only Tiptap history (`src/NoteEditor.tsx:224`); global shortcuts have no structural history handler (`src/App.tsx:355`). Delete explicitly says it cannot be undone (`src/App.tsx:1529`). No structure Undo action is rendered by the toast (`src/App.tsx:1449`).
- Expected: checklist G requires Undo after delete, move and rename, with clear text/drawing/structure scope. Confirmation is a safety provision, but does not satisfy Undo.
- Fix: retain bounded session history for structure mutations and expose a focusable Undo action naming its scope. Keep permanent deletion confirmation per AGENTS.md; distinguish reversible archive from final deletion. Define how restoring deletion handles active/reference IDs and later content edits.
- Status: FAIL for required structural Undo; deletion confirmation separately PASS in code. No claim of accidental loss.

**[G-02] Moderate — Export failure feedback disappears after three seconds**
- Where: export and native window-command toast, all themes/sizes.
- Trigger/state: export_file rejects, or close protection fails to register.
- Observed: export failure is sent to `notify` (`src/App.tsx:486`); notify replaces the previous string and clears it after 3000ms (`src/App.tsx:191`). Toast has role=status and plain message content (`src/App.tsx:1449`) but no pause-on-hover/focus, retry, history, queue or Show in folder action. Native close-protection registration failure also uses this toast (`src/App.tsx:349`). Persistent save errors are handled separately and are not affected.
- Expected: A-1.11 requires 4–6 seconds for routine confirmation, longer error visibility, pause and recovery; G requires actionable failure feedback.
- Fix: represent notification severity/actions explicitly; persist export errors until dismissal or retry, retain successful desktop export path for Show in folder, pause any timed notices while hovered/focused.
- Status: FAIL (code).

**[G-03] Minor — Browser export confirmation claims completed download**
- Where: browser preview notebook/text export.
- Trigger/state: click export and let a browser download be blocked, cancelled or still pending.
- Observed: a synthetic anchor click has no completion acknowledgment (`src/storage.ts:48`); the App immediately announces “Export downloaded.” (`src/App.tsx:481`). Backup history correctly says “Backup download requested” (`src/backupHistory.ts:17`) and Settings asks users to check Downloads (`src/SettingsContent.tsx:59`).
- Expected: truthful post-action content (G/A-1.16), consistent with existing backup wording.
- Fix: change browser toast to “Download requested. Check Downloads to confirm it was saved.” Keep desktop “Export saved” after native acknowledgment.
- Status: FAIL (wording proven); whether downloads are blocked is NOT VERIFIED, not asserted.

**[E-01] Minor — Maximize control retains the wrong accessible action after maximization**
- Where: desktop custom window controls.
- Trigger/state: maximize the window, then inspect its maximize/restore button.
- Observed: the button always has aria-label “Maximize window” and a Square icon even though toggleMaximize will restore when maximized (`src/App.tsx:843`).
- Expected: Windows convention and F accessible names require the current action to be Restore window when maximized.
- Fix: derive name and restore glyph from existing maximized state. Verify Narrator and Snap Layout behavior separately.
- Status: FAIL (static label); native maximize/restore runtime NOT VERIFIED.

## Proven implementation passes

| Check | Status | Exact evidence and limits |
|---|---|---|
| Save status waits for persistence acknowledgement | PASS (code) | `src/useWorkspace.ts:78` awaits save; `:94` stays saving when a newer snapshot or board draft exists; failure sets error at `:97`. Runtime failure injection still needed. |
| Save retry and persistent error | PASS (code) | `src/App.tsx:720` has visible Saving/Saved/Save failed text and click-to-flush; `:1364` alert contains error and Retry. Screen-reader live announcements of status changes NOT VERIFIED (save button is not a live region). |
| Serial saves, revision guard, drafts | PASS (code) | `src/useWorkspace.ts:60` queues saves; `src/storage.ts:35` rejects stale browser revisions and uses navigator.locks at `:46`; `src/recovery.ts:187` commits manifest before reclaiming; conflicting revision is retained at `:121`. Recovery tests exist but not executed here. |
| Closing after save and beforeunload safeguard | PASS (code) | Native close request prevented until flush resolves (`src/App.tsx:335`); failure keeps window open. Browser beforeunload prevented with pending edits (`src/useWorkspace.ts:201`). OS close, shutdown, task termination NOT VERIFIED. |
| Backup age and action | PASS (code) | `src/SettingsContent.tsx:58` age, `:60` seven-day reminder; `src/App.tsx:749` computes due state and `:1323` directly exports backup; `:492` guards duplicate export and records only success at `:497`. Continuous idle midnight threshold update NOT VERIFIED. |
| Browser versus desktop storage distinction | PASS (code) | `src/App.tsx:722`, `:729` distinguish; `src/SettingsContent.tsx:75` About details disclose browser storage/PostgreSQL. |
| Partial import failures and progress | PASS (code) | `src/App.tsx:235` per-file progress; `:263` collects per-file failures; `:280` displays summary; `:1490` reports imported count and failed files. File chooser cancellation does no import (`:224`). Large-file responsiveness NOT VERIFIED. |
| Import guards and recovery guidance | PASS (code) | `src/importFiles.ts:7` 20MB/25 file limits; `:33` PDF page cap; `:43` OCR guidance; `:47` password guidance; `:56` DOCX text limit; `src/App.tsx:257` rejects workspace-capacity overflow. Unsupported arbitrary extensions are parsed as text; file-format fidelity is NOT VERIFIED. |
| Backup merge preserves existing notes | PASS (code) | `src/importBackup.ts:141` mergeBackup remaps IDs, appends current notes and reuses same-name folders; no overwrite confirmation needed for this append flow. |
| Delete confirmation and folder content retention | PASS (code) | `src/App.tsx:1529` names permanent note; `:1532` Cancel before danger action; folder deletion moves notes to null folder at `:1540`. Initial focus behavior parent should verify. Folder dialog description lacks folder name/count (A-1.9 gap if parent reports). |
| Keyboard transfer/reorder alternatives | PASS (code) | `src/useSidebarDrag.ts:65` Alt+Arrow reorder and Alt+Shift+Arrow folder transfer, `:58` restores item focus; help referenced at `:93`; drag cancel Escape/blur `:30`; edge auto-scroll `:156`. Pointer and native WebView2 behavior NOT VERIFIED. |
| Drag target/preview routing | PASS (code) | `src/useSidebarDrag.ts:101` preserves native preview grab offset; `:120` insertion hit test; `:151` before/after/folder markers. `src/useFileDrop.ts:34` folder/document targets, `:58` mixed files handled as batch. Drag-hover auto-expansion before release absent in hook; reveal only on commit `useSidebarDrag.ts:54`. |
| Resizer keyboard/bounds/reset/persistence | PASS (code) | `src/PanelResize.tsx:118` arrows (10px; Shift 40px), Home/End; `:130` double-click reset; `:58` persistence; `:26` measured bounds reserve writing space. `:160` named separator exposes values; `:91` 10px threshold; `:107` cancellation; `:143` blur. Rendered min/max sizing under app scales NOT VERIFIED. |
| Preview Startup disabled explanation | PASS (code) | `src/StartupSettings.tsx:51` installed-app explanation, `:54` disabled until known; `:57` status; `:58` error; `:59` initial-check retry. OS startup registration NOT VERIFIED. |
| Minimum size / frontend native DnD configured | PASS (config) | `src-tauri/tauri.conf.json:18` minWidth850, minHeight600; `:21` dragDropEnabled false. Actual minimum content clipping NOT VERIFIED. |
| Titlebar scoped dragging | PASS (code) | Breadcrumb alone starts native drag and double-click maximize (`src/App.tsx:773`); separate controls at `:835`. Snap Layout maximize-hover support NOT VERIFIED: no native hit-test handler found in inspected Rust. |
| PostgreSQL messages and retry entry | PASS (code, limited) | Missing runtime says reinstall and retains notes (`src-tauri/src/database.rs:176`); database busy gives retry (`:119`); startup connection failure directs log path (`:276`); App load error shows Try again (`src/App.tsx:711`). Disk-full, corrupt database and missing WebView2 runtime outcomes NOT VERIFIED. Installer config uses downloadBootstrapper (`src-tauri/tauri.conf.json:56`). |

## Relevant tests available (not run by this subtask)

`tests/recovery.spec.ts`, `tests/finalization.spec.ts:24`, `:56`, `:63`, `:143`, `tests/permanent-delete.spec.ts`, `tests/sidebar-drag.spec.ts:133`, `tests/sidebar-resize.spec.ts:62`, `tests/reference-resize.spec.ts:69`, `tests/file-import.spec.ts`, `tests/ux-critique.spec.ts:83`, `tests/starter-notebook.spec.ts`, `tests/board-export-flow.spec.ts`, `tests/board-saving.spec.ts`, `tests/rust-boundary.spec.ts`. Existing assertions do not count as passed until execution. Runtime coverage should use parent-run results.

## Native captures still required

Installed Windows/WebView2: Alt+F4 during pending save and save failure; disk-full/export permission rejection/cancel; PostgreSQL missing/corrupt/startup failures; WebView2 bootstrap failure; Explorer file DnD and cancel; Narrator resize/transfer names; maximize/restore, titlebar double-click, Snap Layout hover; 100/125/150/200% display scaling. No native item should be marked PASS from browser evidence alone.

