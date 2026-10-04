## 1. Verdict

**64/100, provisional. Don’t ship this revision as meeting the requested accessibility and interaction standard.** Fix F01–F07 and F09–F11, resolve the modal-background contract F08 with native/assistive testing, and complete section 8’s release checks before claiming WCAG2.2AA conformance. The selected browser tests demonstrate working editor selection, read-only Reference, delete cancellation, panel resizing and recovery scenarios, but they do not establish complete product compliance. Confirmed defects include low-contrast select focus, an unnamed board control, near-disappearing navigation at the minimum window, missing non-drag pointer alternatives, modal focus handling and short-lived error feedback. No Blocker or reproduced data loss was established. The score is an editorial assessment, not a test pass percentage: weighted A65×30%, B65×10%, C65×10%, D75×10%, E60×10%, F50×20%, G75×10%=63.5, rounded64. Unverified behavior earns no asserted PASS.

Audit evidence was collected on October4,2026; consolidated October5. Version 1.3.12, commit `0d3fa69d168402f8bb7740547003be1aff03fcc0`. The attachment calls the product Scribly; project guidance calls it Notify. This report uses the live product title Scribly while applying the supplied Notify guidance. No application source was changed. Three parallel subagents handled shell, editor/board and safety evidence using GPT‑6.1‑sol at medium/medium/low; the primary agent adjudicated their findings and performed runtime checks.

## 2. Coverage table

| Section | Items tested/reviewed | PASS | FAIL | NOT VERIFIED | N/A |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 2464 | 85 | 83 | 1974 | 322 |
| B | 11 | 0 | 4 | 7 | 0 |
| C | 7 | 1 | 2 | 4 | 0 |
| D | 8 | 0 | 4 | 4 | 0 |
| E | 7 | 0 | 4 | 3 | 0 |
| F | 10 | 0 | 3 | 7 | 0 |
| G | 9 | 0 | 6 | 3 | 0 |
| A1.1 Dropdowns/selects | 365 | 5 | 6 | 354 | 0 |
| A1.2 Split buttons | 53 | 0 | 5 | 48 | 0 |
| A1.3 Color palettes | 27 | 0 | 5 | 22 | 0 |
| A1.4 Context menus | 261 | 11 | 11 | 189 | 50 |
| A1.5 Ellipsis/options menus | 209 | 42 | 17 | 150 | 0 |
| A1.6 Ctrl+K search | 27 | 0 | 3 | 8 | 16 |
| A1.7 Dates/metadata | 27 | 1 | 0 | 9 | 17 |
| A1.8 Modals/dialogs | 209 | 9 | 8 | 180 | 12 |
| A1.9 Destructive confirmations | 79 | 9 | 7 | 51 | 12 |
| A1.10 Tooltips | 27 | 0 | 2 | 13 | 12 |
| A1.11 Toasts/inline status | 183 | 1 | 2 | 134 | 46 |
| A1.12 Collapsibles/tree | 53 | 0 | 2 | 29 | 22 |
| A1.13 Rename/editable fields | 131 | 6 | 3 | 75 | 47 |
| A1.14 Drag and drop | 105 | 0 | 2 | 103 | 0 |
| A1.15 Settings sliders/toggles/segments | 131 | 0 | 0 | 131 | 0 |
| A1.16 File pickers/import/export | 209 | 0 | 1 | 208 | 0 |
| A1.17 Resizable panels | 79 | 1 | 3 | 41 | 34 |
| A1.18 Virtualized/long lists | 53 | 0 | 4 | 34 | 15 |
| A1.19 Hover-reveal controls | 79 | 0 | 1 | 39 | 39 |
| A1.20 Canvas overlays | 157 | 0 | 1 | 156 | 0 |

Counts are **reviewed checklist cells**, not unique defects or executed test cases. A contains94 named surfaces×26 atomic A0 checks plus20 A1 capability checks. The20 A1 rows partition A and are not added to it again. B–G count each top-level bullet once: a known failing subcondition makes a composite FAIL; untested subconditions still remain open. PASS means only the explicitly cited source provision or executed browser scenario, never every theme/DPI/native combination. Every cell includes evidence, scope and a capture requirement in the [trigger ledger](D:/Projects/work-essential/audit/trigger-ledger.json) and [B–G ledger](D:/Projects/work-essential/audit/checklist-ledger.json). The separately inventoried182 named control entries each have all nine C states in the [control-state ledger](D:/Projects/work-essential/audit/control-state-ledger.json); full per-control state traversal remains NOT VERIFIED, including enumerating every engine-generated descendant. No hidden engine control is presumed passing.

Browser geometry: Light/Dark×Small/Medium/Large at 850×600 and1280×720, with additional Dark/Medium at 1920×1080 and2560×1080. Default text scale was used for those measurements. Some width snapshots were captured during the existing grid transition; they must not be treated as final-width compliance measurements. Windows display scaling, actual snapped/maximized geometry,200%zoom and live Narrator/NVDA were not tested. Native Tauri dialogs and OS close/startup integration remain NOT VERIFIED.

Verification record:

- Initial isolated selected suite:52/70 passed;18 failed. This is not a green original suite. Some failures came from missing generated logo assets, cold board startup or stale accessible-name/copy assumptions. The source tests were not modified.
- After `npm run prepare:logos` and cache warmup, Board context/brand-logo retest:12/12 passed. Generated catalogs report7,387icons,12,077assets,23skipped variants. Asset count is not the number of successfully accessible grid choices.
- Audit-local copies of selection-color/UX/delete specs updated stale names/copy and opened Reference before interacting with it.21/22 passed in the combined run; the remaining selection scenario passed1/1 after that fixture correction. Thus22 distinct adapted scenarios ultimately passed; this does not replace the original52/70 result or imply unrun tests passed.
- The21st review inspected67files, reported1error/115suggestions. The alleged image-alt error was a regex containing `<img` in `src/attachments.ts:38`, not an unlabeled rendered image. Literal artwork colors/token definitions are not automatically UI defects. This lint output was triaged, not counted as116confirmed findings.
- Dependencies were installed to run the browser checks. No frontend production change was made, so no app build was required for the audit artifact. The full project test suite and installed Tauri build were not run.

Logs: [initial browser run](D:/Projects/work-essential/audit/browser-tests.log), [board/logo retest](D:/Projects/work-essential/audit/board-retest.log), [adapted run](D:/Projects/work-essential/audit/corrected-tests.log), [final selection retest](D:/Projects/work-essential/audit/selection-final-retest.log), [runtime geometry](D:/Projects/work-essential/audit/runtime-measurements.json), [contrast](D:/Projects/work-essential/audit/contrast-measurements.json). The unrelated existing preview on port1420 was excluded; valid runtime evidence uses this worktree’s isolated port1430.

Minimum-window evidence for F03: Large app elements, Dark theme, 850×600 browser viewport, default text scale. The near-empty vertical list slot appears between folder controls and footer.

![Large sizing leaves almost no visible sidebar note-list space at the minimum window](D:/Projects/work-essential/audit/dark-large-850.jpg)

Every named surface, including missing ones, is listed below. Shared-controller code is evidence of a provision; it is not a substitute for each consumer’s runtime matrix.

| A1 group | Actual surface | Matrix cells | PASS | FAIL | NOT VERIFIED | N/A |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Filter All items | 26 | 1 | 1 | 24 | 0 |
| 1 | Sort Manual | 26 | 1 | 0 | 25 | 0 |
| 1 | Reference note/board | 26 | 1 | 0 | 25 | 0 |
| 1 | Move note to folder | 26 | 1 | 0 | 25 | 0 |
| 1 | Note font | 26 | 1 | 0 | 25 | 0 |
| 5 | Appearance topbar | 26 | 6 | 2 | 18 | 0 |
| 5 | Export formats | 26 | 6 | 2 | 18 | 0 |
| 5 | Sidebar note ellipsis | 26 | 6 | 2 | 18 | 0 |
| 5 | Sidebar board ellipsis | 26 | 6 | 2 | 18 | 0 |
| 5 | Folder ellipsis | 26 | 6 | 2 | 18 | 0 |
| 5 | Active note options | 26 | 6 | 2 | 18 | 0 |
| 5 | Active board options | 26 | 6 | 2 | 18 | 0 |
| 4 | Sidebar note right-click | 26 | 5 | 3 | 18 | 0 |
| 4 | Sidebar board right-click | 26 | 5 | 3 | 18 | 0 |
| 4 | Folder right-click | 26 | 0 | 1 | 0 | 25 |
| 4 | Empty sidebar right-click | 26 | 0 | 1 | 0 | 25 |
| 6 | Ctrl+K/sidebar search | 26 | 0 | 2 | 8 | 16 |
| 8 | Settings | 26 | 3 | 1 | 18 | 4 |
| 8 | Keyboard shortcuts | 26 | 3 | 2 | 17 | 4 |
| 13 | New folder | 26 | 3 | 1 | 18 | 4 |
| 13 | Rename folder | 26 | 3 | 1 | 18 | 4 |
| 9 | Remove folder | 26 | 3 | 2 | 17 | 4 |
| 9 | Permanent delete note | 26 | 3 | 2 | 17 | 4 |
| 9 | Permanent delete board | 26 | 3 | 2 | 17 | 4 |
| 8 | Import results | 26 | 3 | 1 | 18 | 4 |
| 16 | Native import file chooser | 26 | 0 | 0 | 26 | 0 |
| 7 | Created/modified metadata | 26 | 0 | 0 | 9 | 17 |
| 10 | Native title tooltips | 26 | 0 | 1 | 13 | 12 |
| 11 | Shell toasts | 26 | 1 | 1 | 5 | 19 |
| 12 | Folder disclosure | 26 | 0 | 1 | 8 | 17 |
| 13 | Note title inline rename | 26 | 0 | 0 | 9 | 17 |
| 13 | Board title inline rename | 26 | 0 | 0 | 9 | 17 |
| 17 | Sidebar resize handle | 26 | 0 | 1 | 8 | 17 |
| 17 | Reference resize handle | 26 | 0 | 1 | 8 | 17 |
| 19 | Note/board hover-reveal controls | 26 | 0 | 0 | 9 | 17 |
| 19 | Folder hover-reveal controls | 26 | 0 | 0 | 9 | 17 |
| 1 | Text style select | 26 | 0 | 0 | 26 | 0 |
| 1 | Code language select | 26 | 0 | 0 | 26 | 0 |
| 2 | Highlighter options | 26 | 0 | 2 | 24 | 0 |
| 2 | Drawing options | 26 | 0 | 2 | 24 | 0 |
| 3 | Selection colors palette (toolbar) | 26 | 0 | 4 | 22 | 0 |
| 4 | Selected-text context palette (right click / Shift+F10) | 26 | 1 | 2 | 23 | 0 |
| 5 | Image options | 26 | 0 | 2 | 24 | 0 |
| 8 | Image preview modal | 26 | 0 | 1 | 25 | 0 |
| 8 | Brand logos modal | 26 | 0 | 1 | 25 | 0 |
| 1 | Logo category select | 26 | 0 | 0 | 26 | 0 |
| 1 | Logo variant select | 26 | 0 | 0 | 26 | 0 |
| 18 | Brand-logo virtualized list | 26 | 0 | 2 | 9 | 15 |
| 1 | Board Insert menu | 26 | 0 | 2 | 24 | 0 |
| 1 | Board Export menu | 26 | 0 | 2 | 24 | 0 |
| 12 | Architecture inspector disclosure | 26 | 0 | 0 | 21 | 5 |
| 1 | Architecture boundary select | 26 | 0 | 0 | 26 | 0 |
| 8 | Export flowchart modal | 26 | 0 | 1 | 25 | 0 |
| 1 | Diagram direction select | 26 | 0 | 0 | 26 | 0 |
| 20 | Excalidraw tool/style overlays | 26 | 0 | 0 | 26 | 0 |
| 20 | Excalidraw shape library | 26 | 0 | 0 | 26 | 0 |
| 20 | Excalidraw help dialog | 26 | 0 | 0 | 26 | 0 |
| 4 | Excalidraw canvas context menu | 26 | 0 | 0 | 26 | 0 |
| 4 | Native editor text/link/code context menu | 26 | 0 | 0 | 26 | 0 |
| 4 | Native Reference context menu | 26 | 0 | 0 | 26 | 0 |
| 16 | Image-file picker | 26 | 0 | 0 | 26 | 0 |
| 16 | Board SVG/PNG/drawing save picker | 26 | 0 | 0 | 26 | 0 |
| 16 | Mermaid download save picker | 26 | 0 | 0 | 26 | 0 |
| 13 | Image caption field | 26 | 0 | 0 | 21 | 5 |
| 19 | Image hover tools and resize handles | 26 | 0 | 0 | 21 | 5 |
| 11 | Board inline copy/export/error feedback | 26 | 0 | 0 | 17 | 9 |
| 11 | Code-copy status | 26 | 0 | 0 | 17 | 9 |
| 11 | Image-insertion status | 26 | 0 | 0 | 17 | 9 |
| 8 | Architecture templates dialog | 26 | 0 | 0 | 26 | 0 |
| 8 | Import Mermaid dialog | 26 | 0 | 0 | 26 | 0 |
| 1 | Architecture template select | 26 | 0 | 0 | 26 | 0 |
| 16 | Mermaid import file chooser | 26 | 0 | 0 | 26 | 0 |
| 20 | Mermaid preview zoom controls | 26 | 0 | 0 | 26 | 0 |
| 14 | Sidebar note/folder native reorder | 26 | 0 | 1 | 25 | 0 |
| 14 | Sidebar folder transfer | 26 | 0 | 0 | 26 | 0 |
| 14 | External file drop/import | 26 | 0 | 0 | 26 | 0 |
| 14 | Editor image drop/paste | 26 | 0 | 0 | 26 | 0 |
| 17 | Image resize | 26 | 0 | 1 | 25 | 0 |
| 15 | Appearance Light/Dark/System segments | 26 | 0 | 0 | 26 | 0 |
| 15 | Appearance Small/Medium/Large segments | 26 | 0 | 0 | 26 | 0 |
| 15 | Appearance text-size range | 26 | 0 | 0 | 26 | 0 |
| 15 | Windows startup switch | 26 | 0 | 0 | 26 | 0 |
| 15 | Board role segments/Snap toggle | 26 | 0 | 0 | 26 | 0 |
| 16 | Notebook/backup browser download | 26 | 0 | 0 | 26 | 0 |
| 16 | Desktop notebook/backup save dialog | 26 | 0 | 0 | 26 | 0 |
| 20 | Excalidraw main menu | 26 | 0 | 1 | 25 | 0 |
| 20 | Excalidraw More tools overlay | 26 | 0 | 0 | 26 | 0 |
| 4 | Native image context menu | 26 | 0 | 0 | 26 | 0 |
| 4 | Native editable title context menu | 26 | 0 | 0 | 26 | 0 |
| 11 | Save progress and persistent save error | 26 | 0 | 0 | 26 | 0 |
| 11 | Loading/load-error/empty notebook state | 26 | 0 | 0 | 26 | 0 |
| 11 | Backup reminder and backup status | 26 | 0 | 0 | 26 | 0 |
| 18 | Sidebar 1/50/187/500-item list | 26 | 0 | 1 | 25 | 0 |
| 16 | Settings Backup import/export controls | 26 | 0 | 0 | 26 | 0 |

Intentional N/A policies: display-only dates have no calendar/month/range interaction; tool multi-configuration popovers may stay open after choosing size/color; modals should not disappear merely on window blur; tooltips must not capture focus; inline fields/statuses have no popover anchoring. Native sidebar DnD has no custom momentum/snap spring requirement. Absent Pinned/Recent/Trash and context surfaces are gaps, not invented implemented controls.

## 3. Findings

### Blocker

None established by this audit.

### Major

**[F01] [Major] Select keyboard focus fails non-text contrast**

- **Where:** Filter and shared AppSelect options; Light/Dark; browser Medium, default text scale.
- **Trigger/State:** Open Filter items and ArrowDown to an unselected option.
- **Observed:** Outline is removed and the only inset focus border is 1px --line. Measured border contrast is 1.07:1 against hover / 1.31:1 against panel in Light, 1.28:1 / 1.45:1 in Dark. The hover fill also stays below 3:1. Evidence: [select-focus.jpg](D:/Projects/work-essential/audit/select-focus.jpg), [contrast-measurements.json](D:/Projects/work-essential/audit/contrast-measurements.json); [src/styles.css:2206](D:/Projects/work-essential/src/styles.css:2206).
- **Expected:** WCAG 1.4.11 requires the custom visual state indicator to contrast at 3:1. The brief additionally requests a 2px indicator; 2px is a project target, not a blanket AA rule.
- **Fix:** Use a 2px inset --accent focus indicator on [data-highlighted], preserve the selected check, and verify accent against both adjacent fills in each theme. Add a forced-colors Highlight outline fallback.
- **Effort:** S

**[F02] [Major] Board main-menu button has no accessible name**

- **Where:** Excalidraw main-menu trigger inside BoardEditor; Dark/Medium at 850×600.
- **Trigger/State:** Navigate to the board main-menu button with keyboard or inspect its accessible name.
- **Observed:** The accessibility snapshot contains a blank “button”; rendered button has no aria-label, title or text and its SVG is aria-hidden. Evidence: [board-main-menu-runtime.json](D:/Projects/work-essential/audit/board-main-menu-runtime.json), [board-minimum.jpg](D:/Projects/work-essential/audit/board-minimum.jpg); [src/BoardEditor.tsx:291](D:/Projects/work-essential/src/BoardEditor.tsx:291).
- **Expected:** WCAG 4.1.2 requires a programmatically determinable control name.
- **Fix:** Supply “Board menu” through the supported engine MainMenu trigger customization or maintained engine patch. Assert the rendered accessible name; include expanded state and owned menu where the engine supports them.
- **Effort:** S

**[F03] [Major] Large size consumes the sidebar note list at the minimum window**

- **Where:** Notes navigation; both themes, Large app size, default text scale, 850×600 browser viewport.
- **Trigger/State:** Choose Large sizing while Sidebar is visible.
- **Observed:** Sidebar scroll area is only 17.1px high including 13.2px padding: approximately 3.9px remain for rows. Creation takes 112.2px, search 48.4px, notebook controls 80px and footer 164.7px. Evidence: [dark-large-850.jpg](D:/Projects/work-essential/audit/dark-large-850.jpg) and [light-large-850.jpg](D:/Projects/work-essential/audit/light-large-850.jpg); src/styles.css sidebar layout.
- **Expected:** E minimum-size usability and D density require usable navigation at the configured 850×600 minimum.
- **Fix:** Add a short-height layout: compact creation into one row, tighten footer/navigation spacing, and let nonessential sidebar chrome scroll. Reserve at least a complete navigable row plus context, then test 96px or more of list space across app/text sizes. Preserve labels and 24px targets.
- **Effort:** M

**[F04] [Major] Sidebar reorder has no equivalent non-drag pointer action**

- **Where:** Folder and note reorder; all themes/sizes; source confirmed.
- **Trigger/State:** Attempt to reorder using a single pointer without dragging.
- **Observed:** Reorder uses native drag or Alt+Up/Down. Context/ellipsis menus have no Move up/down commands for the sidebar order. Keyboard alternatives exist, but do not satisfy the separate single-pointer requirement. Evidence: [src/useSidebarDrag.ts:65](D:/Projects/work-essential/src/useSidebarDrag.ts:65); [src/App.tsx:651](D:/Projects/work-essential/src/App.tsx:651),1016-1078.
- **Expected:** WCAG 2.5.7 requires an equivalent single-pointer method without dragging; keyboard support is a separate requirement.
- **Fix:** Add Move up and Move down to folder/note menus, disabled at boundaries with a reason, calling the same order commits. Preserve item focus and announce the new position. Keep the existing Move to folder select for transfer.
- **Effort:** S

**[F05] [Major] Panel resize lacks a non-drag pointer method for intermediate widths**

- **Where:** Sidebar and Reference resize separators; source confirmed in all theme/size variants.
- **Trigger/State:** Try to choose an intermediate panel width without dragging.
- **Observed:** Arrow/Shift+Arrow/Home/End keyboard paths and double-click reset exist; pointer users can only drag or reset to one width. Evidence: [src/PanelResize.tsx:118](D:/Projects/work-essential/src/PanelResize.tsx:118),160-163.
- **Expected:** WCAG 2.5.7 requires a single-pointer equivalent for the resize outcome.
- **Fix:** Add a small width menu with Narrower/Wider buttons and a labeled numeric width input or clickable native range. Use the same measured bounds, persistence and reset function; expose current width in pixels.
- **Effort:** S

**[F06] [Major] Image resize lacks an equivalent non-drag pointer width control**

- **Where:** Embedded image resize handles and Image options; source confirmed.
- **Trigger/State:** Choose an intermediate image width without a drag or keyboard.
- **Observed:** Pointer resizing, keyboard resizing and Full width exist, but Full width is only one endpoint and cannot reproduce intermediate widths. Evidence: [src/ImageBlockView.tsx:60](D:/Projects/work-essential/src/ImageBlockView.tsx:60),118-144.
- **Expected:** WCAG 2.5.7 requires a non-drag single-pointer equivalent.
- **Fix:** Expose a labeled percentage-width field or clickable preset/step controls inside Image options using the same imageWidth validation. Commit one history step and preserve selection.
- **Effort:** S

**[F07] [Major] Selected-text context menu removes native editing commands**

- **Where:** Ordinary selected rich text in editable NoteEditor; browser Medium; native WebView content not yet inspected.
- **Trigger/State:** Select normal text, then right-click or Shift+F10.
- **Observed:** SelectionColors prevents the native context menu and opens only Text colors, Background colors, reset and More colors. Cut/Copy/Paste/Spell-check are absent from this custom surface. Empty/code selections deliberately preserve native behavior. Evidence: [selection-colors.jpg](D:/Projects/work-essential/audit/selection-colors.jpg); [src/SelectionColors.tsx:37](D:/Projects/work-essential/src/SelectionColors.tsx:37),73-91.
- **Expected:** A1.4 explicitly requires native text-editing commands to remain available. Ctrl+C/V shortcuts continuing to work does not restore context-menu parity.
- **Fix:** Preserve the native menu for ordinary selected text and offer colors through the toolbar, or provide a supported editing menu with clipboard/spelling integration and platform limitations clearly handled. Test WebView2 clipboard permissions and spellcheck.
- **Effort:** M

**[F08] [Major] Modals lack explicit background-inert enforcement**

- **Where:** Settings, folder/delete/import/brand dialogs and image preview; all theme/size variants; DOM/source confirmed.
- **Trigger/State:** Open a modal and inspect background interaction exclusion.
- **Observed:** Dialog wraps Tab only at endpoints and implements no explicit background-inert mechanism; application siblings have no inert attribute. ImagePreview has the same endpoint-only pattern. Evidence: [dialog-runtime.json](D:/Projects/work-essential/audit/dialog-runtime.json); [src/Dialog.tsx:38](D:/Projects/work-essential/src/Dialog.tsx:38); [src/App.tsx:886](D:/Projects/work-essential/src/App.tsx:886),1379; [src/ImageBlockView.tsx:16](D:/Projects/work-essential/src/ImageBlockView.tsx:16). Background DOM presence alone does not prove operability or accessibility-tree exposure: the backdrop/aria-modal can constrain some paths. Pointer reachability, background Tab escape and screen-reader traversal are NOT VERIFIED.
- **Expected:** A1.8 and the ARIA APG modal-dialog pattern require background content to be inert and focus contained. Do not claim a WCAG keyboard trap from this evidence alone.
- **Fix:** Centralize modal ownership, inert app siblings with restoration on close, and contain focus including focus starting outside the dialog. Treat nested portaled selects as part of the modal; do not inert the active select portal.
- **Effort:** M

**[F09] [Major] Replacing Settings with shortcuts drops focus to the body**

- **Where:** Settings → About → Keyboard shortcuts; browser Medium.
- **Trigger/State:** Activate Keyboard shortcuts from within Settings.
- **Observed:** Dialog remains mounted with a mount-only focus effect while its focused content is removed; activeElement becomes BODY. Subsequent Tab enters Done inside the modal. Evidence: [src/Dialog.tsx:27](D:/Projects/work-essential/src/Dialog.tsx:27); [src/App.tsx:1487](D:/Projects/work-essential/src/App.tsx:1487); [modal-focus-leak.json](D:/Projects/work-essential/audit/modal-focus-leak.json) records the later Tab outcome, not a successful escape.
- **Expected:** A0 initial focus/logical restoration and WCAG 2.4.3 focus order require an intentional focus destination on surface replacement.
- **Fix:** Key the modal invocation or rerun initial-focus management on its identity; focus the shortcuts heading or Done and preserve a stable outer return owner. Test Settings→Shortcuts→close and nested select paths.
- **Effort:** S

**[F10] [Major] Structure edits have no Undo history**

- **Where:** Folder rename/removal and note/folder reorder/transfer; all variants; source confirmed.
- **Trigger/State:** Move or rename an item and use Undo.
- **Observed:** Workspace mutations commit directly. Toolbar Undo is Tiptap history, with no workspace history or toast Undo action. Evidence: [src/App.tsx:215](D:/Projects/work-essential/src/App.tsx:215),566-577,1536-1548; [src/useSidebarDrag.ts:44](D:/Projects/work-essential/src/useSidebarDrag.ts:44),65; [src/NoteEditor.tsx:224](D:/Projects/work-essential/src/NoteEditor.tsx:224).
- **Expected:** G requires explicit text/drawing/structure scope and Undo after move/rename. Permanent deletion must retain the project’s explicit irreversible confirmation.
- **Fix:** Add bounded session history for structural operations and a named Undo action (“Undo move”). Restore order/folder names without replacing newer document edits. Keep final deletion irreversible; decide separately whether a reversible Trash stage belongs before it.
- **Effort:** M

**[F11] [Major] Error toasts disappear before users can recover**

- **Where:** Export/native command feedback; all variants; source confirmed.
- **Trigger/State:** An export or native close-protection registration fails.
- **Observed:** notify replaces the previous message and clears it after 3000ms; no pause, queue, history or retry action exists. Persistent save errors are separate and remain visible. Evidence: [src/App.tsx:191](D:/Projects/work-essential/src/App.tsx:191),341-349,486,1449-1453.
- **Expected:** A1.11 asks for longer errors and pause/recovery; G asks for actionable failure handling.
- **Fix:** Store severity/actions with each notice. Keep errors until dismissed or retried; routine success may use 5s paused on hover/focus. Bound the queue and expose the affected action. Do not convert persistent save errors into transient toasts.
- **Effort:** M

### Minor

**[F12] [Minor] Narrow Reference covers writing instead of resolving panel priority**

- **Where:** Reference open beside a note; Dark/Medium, 850×600 browser viewport.
- **Trigger/State:** Open Reference at the minimum width with Sidebar visible.
- **Observed:** Reference becomes a 310px absolute surface and overlaps approximately 300px of the 559.4px editor area. Evidence: [reference-minimum.jpg](D:/Projects/work-essential/audit/reference-minimum.jpg); [src/styles.css:1867](D:/Projects/work-essential/src/styles.css:1867).
- **Expected:** E requests graceful collapse of Reference before Sidebar and readable writing space; project guidance gives writing priority.
- **Fix:** At the narrow breakpoint, use an explicit single-support-panel policy or collapse Reference with a clear reopen affordance. Preserve its selected item, editor instance/selection and scroll. If an overlay is retained by product decision, make it temporary and explicitly dismissible.
- **Effort:** M

**[F13] [Minor] Minimum-window chrome exceeds the writing budget**

- **Where:** Note mode both themes, Small/Medium/Large at 850×600; Board Medium.
- **Trigger/State:** Compare visible writing height with topbar/toolbar/footer height.
- **Observed:** Conservative note chrome lower bounds are27.33%,28.97%,31.57%; Board Medium topbar+title+toolbar is25.08%. Note title/margins are excluded, so note total is higher. Evidence: [runtime-measurements.json](D:/Projects/work-essential/audit/runtime-measurements.json); [board-minimum.jpg](D:/Projects/work-essential/audit/board-minimum.jpg). Native frame/DPI not measured.
- **Expected:** E flags non-content UI above approximately 25% of vertical space.
- **Fix:** Use short-height density for footer/topbar/tool spacing, consolidate secondary commands into existing menus, and recompute the same clearly defined budget. Keep a stable formatting toolbar and readable document.
- **Effort:** M

**[F14] [Minor] Search has no result-keyboard navigation or Escape-clear path**

- **Where:** Sidebar Ctrl+K search; browser Medium and source all variants.
- **Trigger/State:** Search “Welcome”, then ArrowDown, Enter, Ctrl+Enter and Escape.
- **Observed:** Input remains focused; query remains after Escape; no result-arrow/Enter/Ctrl+Enter handlers are present. Results remain reachable through Tab. Evidence: [src/App.tsx:363](D:/Projects/work-essential/src/App.tsx:363),387-392,901-909.
- **Expected:** A1.6 requests arrow navigation, Enter open, Ctrl+Enter Reference, and Escape clears then dismisses.
- **Fix:** Track a highlighted result, scroll it into view, open with Enter and use the existing Reference action for Ctrl+Enter. First Escape clears; next Escape returns to writing. Do not add loading/debounce to synchronous local filtering unless measurement warrants it.
- **Effort:** M

**[F15] [Minor] Sidebar and active-item options diverge**

- **Where:** Sidebar note/board ellipsis versus active note/board options; all variants.
- **Trigger/State:** Open options for the same item in the row and document header.
- **Observed:** Row actions expose Archive, Reference and Delete; active-item options also expose duplicate/move/export paths. Evidence: [src/App.tsx:667](D:/Projects/work-essential/src/App.tsx:667) versus :1210-1267.
- **Expected:** A1.4/A1.5 require consistent actions for the same target.
- **Fix:** Build the item action descriptors once and render them in row, active-item and context surfaces. Keep irreversible Delete last with danger styling and scope exports to the targeted item.
- **Effort:** M

**[F16] [Minor] Note/board right-click menu anchors to ellipsis rather than pointer**

- **Where:** Sidebar note/board context menu; all variants; source confirmed.
- **Trigger/State:** Right-click far from the row ellipsis.
- **Observed:** Handler sets the row menu owner but supplies the ellipsis anchor without the pointer point. ActionPopover supports point anchoring but this caller does not use it. Evidence: [src/App.tsx:620](D:/Projects/work-essential/src/App.tsx:620); [src/ActionPopover.tsx:14](D:/Projects/work-essential/src/ActionPopover.tsx:14).
- **Expected:** A1.4 requests cursor origin with collision flipping; ellipsis opening should remain trigger anchored.
- **Fix:** Capture clientX/clientY for context invocation and pass point. For Shift+F10/Menu key use the focused row rectangle. Retain the same actions and 10px viewport clamp.
- **Effort:** S

**[F17] [Minor] Palette grid omits spatial Left/Right navigation**

- **Where:** Expanded Selection colors palette; all variants; source confirmed.
- **Trigger/State:** Navigate the three-column swatch grid with Left/Right.
- **Observed:** Shared action navigation handles Up/Down/Home/End over a flat button array only. Current-color checks and aria-pressed are present. Evidence: [src/ActionPopover.tsx:56](D:/Projects/work-essential/src/ActionPopover.tsx:56); [src/styles.css:2250](D:/Projects/work-essential/src/styles.css:2250); [src/SelectionColors.tsx:78](D:/Projects/work-essential/src/SelectionColors.tsx:78).
- **Expected:** A1.3 expects swatch-grid navigation consistent with its visual rows/columns.
- **Fix:** Scope a roving grid navigator to each color group: Left/Right±1, Up/Down±column count, Home/End appropriate boundary. Scroll focused cells into view and preserve clear selected versus focused state.
- **Effort:** S

**[F18] [Minor] Palette toolbar trigger does not announce expanded state**

- **Where:** Text and background color options button; all variants; source confirmed.
- **Trigger/State:** Open the palette from the toolbar.
- **Observed:** Button has a name and disabled state but no aria-haspopup, aria-expanded or aria-controls. Evidence: [src/NoteEditor.tsx:287](D:/Projects/work-essential/src/NoteEditor.tsx:287).
- **Expected:** A0 surface ownership/state semantics; APG trigger patterns.
- **Fix:** Expose palette open state; add aria-haspopup="dialog", aria-expanded and a stable aria-controls ID when mounted. Preserve the existing range-capture behavior.
- **Effort:** S

**[F19] [Minor] Palette trigger re-click reopens instead of dismissing**

- **Where:** Text and background color options button; all variants; source confirmed.
- **Trigger/State:** Click the toolbar trigger while its palette is already open.
- **Observed:** Toolbar calls the open callback; SelectionColors unconditionally sets a new popup. Evidence: [src/NoteEditor.tsx:46](D:/Projects/work-essential/src/NoteEditor.tsx:46); [src/SelectionColors.tsx:23](D:/Projects/work-essential/src/SelectionColors.tsx:23).
- **Expected:** A0 trigger re-click dismissal and predictable reversal.
- **Fix:** Use an explicit toggle command tied to the same palette owner. Close semantically immediately and restore editor focus/range; rapid reopen may retarget any presence animation.
- **Effort:** S

**[F20] [Minor] Action popovers lack window-blur dismissal**

- **Where:** Shell/tool/image/board action popovers; all variants; source confirmed.
- **Trigger/State:** Switch to another window while the popover is open.
- **Observed:** Effect registers resize, pointerdown, scroll and owner events, but no window blur listener. Evidence: [src/ActionPopover.tsx:29](D:/Projects/work-essential/src/ActionPopover.tsx:29). Actual WebView blur timing is NOT VERIFIED.
- **Expected:** A0 asks nonmodal surfaces to dismiss on window blur.
- **Fix:** Register window blur close and remove it on cleanup. Preserve focus in the newly active window; restore the app owner only on appropriate in-app keyboard dismissal.
- **Effort:** S

**[F21] [Minor] Menus and dialogs unmount without an exit**

- **Where:** Conditional ActionPopover/Dialog consumers; all variants; source confirmed.
- **Trigger/State:** Close a menu/dialog.
- **Observed:** 100ms opacity entry is declared but surfaces are removed immediately on close. Legacy 200ms modal keyframes are overridden later. Evidence: [src/styles.css:2183](D:/Projects/work-essential/src/styles.css:2183),2274-2279; [src/App.tsx:1456](D:/Projects/work-essential/src/App.tsx:1456); [src/SelectionColors.tsx:72](D:/Projects/work-essential/src/SelectionColors.tsx:72).
- **Expected:** A0/B ask80–150ms exits; AGENTS requires immediate semantic dismissal and live reversal.
- **Fix:** Retain a noninteractive exiting shell for100ms opacity, restore focus immediately, and retarget live opacity on reopen. Under reduced motion remove instantly. Do not tie mutations or saves to completion.
- **Effort:** M

**[F22] [Minor] Destructive confirmation initially focuses Close instead of Cancel**

- **Where:** Delete note/board and Remove folder dialogs; browser note deletion confirmed, other callers source confirmed.
- **Trigger/State:** Open the destructive confirmation.
- **Observed:** Dialog chooses the first available button, the header Close control. Cancel closes safely and returned focus to Note options in the observed browser flow. Evidence: [dialog-runtime.json](D:/Projects/work-essential/audit/dialog-runtime.json); [src/Dialog.tsx:27](D:/Projects/work-essential/src/Dialog.tsx:27),72-83; [src/App.tsx:1529](D:/Projects/work-essential/src/App.tsx:1529).
- **Expected:** A1.9 requests Cancel default focus; APG recommends least-destructive initial focus where appropriate.
- **Fix:** Pass initialFocus pointing to Cancel on destructive dialogs. Keep Delete danger styled and require ordinary activation; no automatic confirmation on press.
- **Effort:** S

**[F23] [Minor] New/rename folder initially focuses Close instead of the field**

- **Where:** New folder/Rename folder modal; source confirmed.
- **Trigger/State:** Open a folder editing dialog.
- **Observed:** Callers pass no initialFocus and Dialog selects header Close; rename has no select-all-on-entry. Evidence: [src/Dialog.tsx:27](D:/Projects/work-essential/src/Dialog.tsx:27); [src/App.tsx:1495](D:/Projects/work-essential/src/App.tsx:1495).
- **Expected:** A0 appropriate entry focus and A1.13 select-all on rename entry.
- **Fix:** Pass the folder input as initialFocus and select its existing name for Rename. Keep field label and maxLength80; announce length/validation where needed.
- **Effort:** S

**[F24] [Minor] Unsaved folder draft closes without a discard policy**

- **Where:** Folder create/rename dialogs; source confirmed.
- **Trigger/State:** Edit the name, then press Escape, Close or click the backdrop.
- **Observed:** All paths call onClose and remove the uncommitted field value without a dirty-draft guard. Evidence: [src/Dialog.tsx:34](D:/Projects/work-essential/src/Dialog.tsx:34),65-66; [src/App.tsx:1507](D:/Projects/work-essential/src/App.tsx:1507).
- **Expected:** A1.8 requests an explicit unsaved-flow policy; avoid confirm fatigue for unchanged drafts.
- **Fix:** Track whether the local name differs from its initial value. Preserve the draft on accidental outside click or present Discard/Keep editing only for a dirty draft. Escape behavior must remain immediate and documented.
- **Effort:** S

**[F25] [Minor] Mermaid creation draft closes without preservation or discard confirmation**

- **Where:** Import Mermaid/Architecture templates create dialog; source confirmed.
- **Trigger/State:** Edit source/title then dismiss.
- **Observed:** Dialog receives unconditional onClose; local code/title/preview state disappears on unmount. Conversion request tokens correctly ignore late results, but do not preserve drafts. Evidence: [src/CreateBoardDialog.tsx:15](D:/Projects/work-essential/src/CreateBoardDialog.tsx:15),50-52.
- **Expected:** A1.8 unsaved import flows require an explicit policy.
- **Fix:** Keep a session draft by mode or guard dismissal when source/title changed. Preserve token cancellation, and never create the board from a cancelled conversion.
- **Effort:** M

**[F26] [Minor] Folder-removal wording omits the folder name and affected count**

- **Where:** Remove folder confirmation; all variants; source confirmed.
- **Trigger/State:** Remove a populated folder.
- **Observed:** Generic explanation does not identify the folder/count. Notes are moved to Unfiled rather than deleted. Evidence: [src/App.tsx:1527](D:/Projects/work-essential/src/App.tsx:1527).
- **Expected:** A1.9 requires specific named/count wording.
- **Fix:** Use “Remove ‘Folder name’?” and “Move N notes and boards to Unfiled. Their content stays intact.” Keep Cancel first and danger action last.
- **Effort:** S

**[F27] [Minor] Board deletion uses note terminology**

- **Where:** Permanent-delete board dialog/toast; all variants; source confirmed.
- **Trigger/State:** Delete a board from its options.
- **Observed:** Shared confirmation and feedback use note wording for board items. Evidence: [src/App.tsx:1470](D:/Projects/work-essential/src/App.tsx:1470),1569.
- **Expected:** G consistent note/board terms and A1.9 target-specific confirmation.
- **Fix:** Derive item kind and title once for dialog, confirm button and result notice. Preserve the irreversible warning.
- **Effort:** S

**[F28] [Minor] Image caption Escape commits instead of cancels**

- **Where:** Image caption field; source confirmed.
- **Trigger/State:** Change caption then press Escape.
- **Observed:** onChange calls updateAttributes immediately; Enter and Escape both close without restoring the initial caption. Evidence: [src/ImageBlockView.tsx:126](D:/Projects/work-essential/src/ImageBlockView.tsx:126).
- **Expected:** A1.13 Enter confirms/Escape cancels edit intent.
- **Fix:** Edit a local caption draft, commit on Enter or an explicit blur policy, restore the captured caption on Escape, and make one undoable content transaction.
- **Effort:** S

**[F29] [Minor] Folder disclosure state resets across sessions**

- **Where:** Sidebar folder disclosure; all variants; source confirmed.
- **Trigger/State:** Collapse/expand a folder and reload.
- **Observed:** openFolders starts with hardcoded work/data entries and is not persisted with workspace preferences. Evidence: [src/App.tsx:83](D:/Projects/work-essential/src/App.tsx:83).
- **Expected:** A1.12 requires session persistence.
- **Fix:** Persist disclosure IDs in view preferences, prune removed folders and retain the seed policy for genuinely new folders. Do not modify document content.
- **Effort:** S

**[F30] [Minor] Drag hover does not expand a collapsed destination folder**

- **Where:** Native sidebar note transfer; all variants; source confirmed.
- **Trigger/State:** Drag a note over a collapsed folder and pause.
- **Observed:** Folder opening occurs on commit, not during hover; no hover-open timer exists in the drag hook. Evidence: [src/useSidebarDrag.ts:54](D:/Projects/work-essential/src/useSidebarDrag.ts:54),120-156.
- **Expected:** A1.12/A1.14 requests drag-hover auto-expand.
- **Fix:** Use a cancellable roughly 600ms hover timer on valid folder targets, clear it on leave/drop/Escape/blur, and retain native drag behavior and exact insertion-slot hit testing.
- **Effort:** S

**[F31] [Minor] Hover-revealed actions change title geometry**

- **Where:** Sidebar note/board rows; all variants; source confirmed.
- **Trigger/State:** Hover or focus within a row.
- **Observed:** Title right padding jumps from9px to78px when controls appear, changing available label width by69px. Focus-within and hover:none visibility support exist. Evidence: [src/styles.css:2388](D:/Projects/work-essential/src/styles.css:2388),2499-2500.
- **Expected:** A1.19 requires no layout shift when actions reveal.
- **Fix:** Reserve the controls column in the resting layout and animate only their opacity. Keep focus-within/touch visibility and stable pointer travel between row and buttons.
- **Effort:** S

**[F32] [Minor] Native title tooltips do not implement the keyboard tooltip contract**

- **Where:** Toolbar/sidebar/window icon controls; source confirmed; native timing unmeasured.
- **Trigger/State:** Focus an icon-only button with the keyboard.
- **Observed:** Native title attributes provide pointer hints but no app-controlled focus tooltip or aria-describedby. Some folder/window/close controls have a valid aria-label but no tooltip. Evidence: [src/NoteEditor.tsx:223](D:/Projects/work-essential/src/NoteEditor.tsx:223); [src/App.tsx:838](D:/Projects/work-essential/src/App.tsx:838),1011,1019; [src/Dialog.tsx:80](D:/Projects/work-essential/src/Dialog.tsx:80).
- **Expected:** A1.10 requires focus presentation, shortcut text, Escape dismissal and consistent tooltip timing. This is distinct from an accessible-name failure.
- **Fix:** Use one shared tooltip:500ms initial pointer delay, immediate adjacent transfer, focus-visible opening, Escape/click closing, no focus capture, and described-by for supplementary text. Keep accessible names independent.
- **Effort:** M

**[F33] [Minor] Long select values truncate without a discoverable full label**

- **Where:** AppSelect consumers, especially font/code/variant/boundary; source confirmed.
- **Trigger/State:** Choose a long label at narrow width or large text.
- **Observed:** Trigger span ellipsizes; no full-value tooltip is supplied. Accessible selected text provision does not give a sighted keyboard user the clipped value. Evidence: [src/AppSelect.tsx:15](D:/Projects/work-essential/src/AppSelect.tsx:15); [src/styles.css:2170](D:/Projects/work-essential/src/styles.css:2170).
- **Expected:** A1.1 requests full-label discovery on truncation.
- **Fix:** Show a focus/pointer tooltip only when scrollWidth exceeds clientWidth, containing the full selected label. Preserve the field’s accessible name and value.
- **Effort:** S

**[F34] [Minor] Logo result changes have no live count announcement**

- **Where:** Brand-logo search/category/view; all variants; source confirmed.
- **Trigger/State:** Change a query/category and wait for results.
- **Observed:** Result count is a plain paragraph. Listbox active descendant/position exists but is not an automatic filtered-count announcement. Evidence: [src/BrandLogoPicker.tsx:99](D:/Projects/work-essential/src/BrandLogoPicker.tsx:99).
- **Expected:** A1.18 requests an “n results” live announcement; WCAG 4.1.3 applies when a visual result status is updated without focus movement.
- **Fix:** Expose a polite atomic status for the settled count, briefly debounce rapid typing, and distinguish loading/no-match/count. Verify actual NVDA/Narrator speech without duplicating active-item announcements.
- **Effort:** S

**[F35] [Minor] Logo scroll position is lost on reopen**

- **Where:** Brand-logo picker virtual list; source confirmed.
- **Trigger/State:** Scroll far into All brands, close, reopen.
- **Observed:** Scroll state initializes/reset locally and picker conditionally mounts. Evidence: [src/BrandLogoPicker.tsx:32](D:/Projects/work-essential/src/BrandLogoPicker.tsx:32),52; [src/BoardEditor.tsx:317](D:/Projects/work-essential/src/BoardEditor.tsx:317).
- **Expected:** A1.18 requires back/reopen scroll retention.
- **Fix:** Keep query/category/view/scroll offset in the board-owned picker state and restore after catalog geometry is ready. Keep fixed virtual row geometry and focused-item scroll behavior.
- **Effort:** S

**[F36] [Minor] Board exports lack a busy state and duplicate-submit guard**

- **Where:** Drawing/SVG/PNG export; all variants; source confirmed.
- **Trigger/State:** Start an export, reopen Export and start it again before generation/save resolves.
- **Observed:** Async export functions have no shared exportBusy/ref/status. copyBusy only protects Mermaid clipboard work. Evidence: [src/BoardEditor.tsx:206](D:/Projects/work-essential/src/BoardEditor.tsx:206),249-256,311-312. Actual >1s latency has not been measured.
- **Expected:** C rapid-click safety and A1.16/B progress for lengthy operations.
- **Fix:** Use one export operation owner and an announced Generating/Saving status. Reject duplicate submissions synchronously and restore on cancel/failure; keep an explanation on disabled commands.
- **Effort:** S

**[F37] [Minor] Failure toast always displays a success check**

- **Where:** Shell toasts; all variants; source confirmed.
- **Trigger/State:** An export/native command produces an error notice.
- **Observed:** Toast always renders Check regardless of severity. Evidence: [src/App.tsx:1449](D:/Projects/work-essential/src/App.tsx:1449).
- **Expected:** G/A1.11 require causal, truthful feedback; do not imply success on failure.
- **Fix:** Render WarningCircle for errors and Check for acknowledged successes from an explicit severity field. Keep readable text and live-region priority appropriate.
- **Effort:** S

**[F38] [Minor] Browser export says downloaded without completion evidence**

- **Where:** Browser notebook/text export; all variants; source confirmed.
- **Trigger/State:** Request an export that may be pending/blocked/cancelled by the browser.
- **Observed:** storage clicks an anchor then App says “Export downloaded.” Backup wording already says request/check Downloads. Evidence: [src/storage.ts:48](D:/Projects/work-essential/src/storage.ts:48); [src/App.tsx:481](D:/Projects/work-essential/src/App.tsx:481); [src/backupHistory.ts:17](D:/Projects/work-essential/src/backupHistory.ts:17); [src/SettingsContent.tsx:59](D:/Projects/work-essential/src/SettingsContent.tsx:59).
- **Expected:** G truthful acknowledgement and consistent post-action content.
- **Fix:** Use “Download requested. Check Downloads to confirm it was saved.” Keep desktop saved wording only after the native save acknowledgement.
- **Effort:** S

**[F39] [Minor] Secondary helper text starts below the brief’s minimum**

- **Where:** Highlighter mode/helper and code hints; default text scale; source confirmed.
- **Trigger/State:** Read tool/helper text without increasing the text setting.
- **Observed:** Base declarations use11px. Other app type scales do not justify these one-off values. Evidence: [src/styles.css:860](D:/Projects/work-essential/src/styles.css:860),863,2142.
- **Expected:** D specifies at least12px secondary text; this is a project readability target rather than a universal WCAG font-size rule.
- **Fix:** Use a shared secondary token of 12px multiplied by text scale and verify wrapping at minimum height. Do not shrink to preserve fixed-height controls.
- **Effort:** S

**[F40] [Minor] Note title has no equivalent heading landmark**

- **Where:** Active note document title; browser/source.
- **Trigger/State:** Navigate document headings.
- **Observed:** Title is a textarea; the observed default note has no h1. User-authored headings may exist later, but do not label the document title. Evidence: [runtime-measurements.json](D:/Projects/work-essential/audit/runtime-measurements.json) headings; [src/App.tsx:1162](D:/Projects/work-essential/src/App.tsx:1162).
- **Expected:** F explicitly requests the note title as h1. WCAG1.3.1 requires meaningful structure, but does not mandate h1 solely by level.
- **Fix:** Provide an accessible document-title heading associated with the editable title control, using a visually hidden h1 if necessary to preserve editing geometry. Avoid duplicated screen-reader text.
- **Effort:** S

**[F41] [Minor] Maximized window still announces Maximize**

- **Where:** Native custom maximize/restore button; source confirmed; native runtime NOT VERIFIED.
- **Trigger/State:** Maximize then inspect the action available.
- **Observed:** Button always says “Maximize window” and uses Square although toggleMaximize restores an already maximized window. Evidence: [src/App.tsx:843](D:/Projects/work-essential/src/App.tsx:843).
- **Expected:** Windows action-label convention requires the current available action to be accurately named. Do not treat this static label alone as a proven standalone WCAG4.1.2 failure without checking the exposed state/value.
- **Fix:** Derive Restore window/Maximize window and the matching regular-weight glyph from maximized state. Retest actual Snap Layout hover and Narrator separately.
- **Effort:** S

**[F42] [Minor] Icon family and routine decorative animation violate project consistency**

- **Where:** App shell/editor AnimatedIcon alongside Phosphor controls; source confirmed.
- **Trigger/State:** Hover/focus routine writing controls.
- **Observed:** AnimatedIcon imports Lucide animateicons while other controls use Phosphor; duration is450ms on hover/focus. Reduced-motion handling exists, but the animation is decorative rather than a changed action state. Evidence: [src/AnimatedIcon.tsx:1](D:/Projects/work-essential/src/AnimatedIcon.tsx:1),100; [src/App.tsx:3](D:/Projects/work-essential/src/App.tsx:3).
- **Expected:** AGENTS requests regular-weight Phosphor; D one icon set; B causal motion.
- **Fix:** Use existing regular-weight Phosphor for routine controls and preserve immediate background press feedback. Retain animated feedback only where it conveys a specific state transition.
- **Effort:** M

**[F43] [Minor] Disabled tool actions omit explanatory reasons**

- **Where:** Highlight selected text and Copy for Miro disabled commands; source confirmed.
- **Trigger/State:** Open options with no eligible text or unsupported board conversion.
- **Observed:** Buttons are disabled but give no targeted reason for the unavailable action. Keyboard navigation skips them correctly. Evidence: [src/HighlighterTools.tsx:94](D:/Projects/work-essential/src/HighlighterTools.tsx:94); [src/BoardEditor.tsx:314](D:/Projects/work-essential/src/BoardEditor.tsx:314).
- **Expected:** A0 disabled states must explain why; A1.15 uses installed-app reasons as the existing model.
- **Fix:** Supply adjacent or tooltip help: “Select editable text first” and the actual unsupported-conversion reason. Link with aria-describedby; do not put explanations only on an unfocusable disabled element.
- **Effort:** S

### Nit

**[F44] [Nit] Duplicate folder names have no inline distinction**

- **Where:** Folder create/rename; source confirmed; product allowance unresolved.
- **Trigger/State:** Submit a name already used by another folder.
- **Observed:** Submit trims/nonempty-checks only; no duplicate feedback or disambiguation exists. Evidence: [src/App.tsx:566](D:/Projects/work-essential/src/App.tsx:566).
- **Expected:** A1.13 requests duplicate-name validation; duplicate names may be an intentional product capability.
- **Fix:** [NEEDS INPUT] Decide whether duplicates are allowed. If disallowed, show an associated inline error and retain focus/draft; if allowed, document the policy and disambiguate destinations where necessary.
- **Effort:** S



Adjudication limits: the alleged delete-Cancel lost-focus defect was not retained: browser Cancel returned to Note options. The file named `modal-focus-leak.json` records focus **inside** the modal after Tab; it does not prove a keyboard escape. Toolbar horizontal overflow at 850px is intentional and scrollable, not permanent clipping. Sampled muted foreground passes4.5:1 in both themes: Light5.39–6.79 across selected/panel/sidebar/chrome, Dark5.80–8.39. All authored semantic text/background combinations in the adapted color tests pass4.5:1. These limited passes do not certify every placeholder, icon or third-party control. Selected-text palette current choices have checks and aria-pressed. Save failure has persistent visible error/Retry; it is not subject to the transient export-toast timeout. Permanent delete is explicitly confirmed as irreversible; no unobserved accidental loss is alleged.

## 4. Missing trigger surfaces

| Surface/capability | Status, concrete gap and targeted action |
| --- | --- |
| Folder right-click / Shift+F10 | FAIL brief parity: no folder context handler. Reuse Folder options descriptors with pointer/focused-row origin. |
| Empty-sidebar context menu | FAIL brief capability: no New note/New board/New folder/Import context entry. Add only those existing actions. |
| Image custom context actions | FAIL brief parity: image options exist but are not mapped to right-click/Shift+F10. Native menu contents remain NOT VERIFIED; preserve text editing when captions are targeted. |
| Link actions | NOT VERIFIED native follow behavior. Imported links have `openOnClick:false` and no toolbar/context create/edit/follow action. Capture Ctrl+click, Enter and native context in WebView2 before deciding whether an explicit Open/Edit/Copy link surface is needed. |
| Ordinary text edit menu | FAIL for selected rich text, F07. Empty/code/native Reference paths are retained by implementation but native clipboard/spelling contents remain NOT VERIFIED. Do not add a custom code menu solely to replace a working native one. |
| Command palette / grouped commands | FAIL requested capability: Ctrl+K focuses the existing sidebar filter. No commands/recent/grouped results, match highlighting, suggestions or Ctrl+Enter path. F14 supplies the frequent keyboard path first; a full palette is a product-scope decision. |
| Date/time/reminder picker | N/A: dates are display-only, reminders/ranges are absent. Created text and modified native-title metadata exist. Do not add a calendar to solve a nonexistent editing task. Locale/timezone announcements remain NOT VERIFIED. |
| Pointer reorder/width actions | FAIL AA path, F04–F06. Add equivalent click controls, retaining keyboard and drag behavior. |
| Persistent actionable error notice | FAIL, F11/F37. Existing save Retry is a useful provision; export/window errors need equivalent recovery ownership. |
| Undo structure notice / history | FAIL move/rename/removal scope, F10. Reversible Archive already exists. [NEEDS INPUT] A Trash stage before final permanent deletion is a product decision; never advertise Undo on actual permanent deletion. |
| Keyboard-focus tooltips | FAIL F32; accessible-name labels alone do not implement the requested tooltip behavior. |
| Custom/recent text colors and live preview | FAIL brief capability. Fixed semantic palette intentionally validates safe choices. [NEEDS INPUT] Prefer retaining those guarantees; add arbitrary colors only with validation/contrast warnings, and make preview reversible without document-save churn. |
| Pinned / Recently opened / Trash | FAIL requested capability, absent in this checkout. Archive/Unfiled are available; do not report the absent groups as a broken implemented accordion. [NEEDS INPUT] Confirm product scope before adding these features. |
| Bulk item selection/actions | FAIL requested power-user capability: no sidebar multi-select model or bulk actions. Explicitly scoped product work, not an inferred AA violation. |
| Drag to Reference | FAIL requested shortcut capability: no Reference drop target. Existing Show as reference button is available. Add only if demanded by product scope, using native DnD and the same reference commit. |
| Submenus with hover intent | N/A for existing flat app action dialogs. Test actual engine submenu behavior in R2; do not invent a submenu just to satisfy the checklist. |
| Discard-draft surface | FAIL dirty folder/Mermaid flows F24/F25. Unchanged drafts should close without a confirmation. |
| Overwrite-on-import / empty Trash | N/A current flows: backup merge appends/remaps IDs, and Trash does not exist. Do not add overwrite confirmation to the non-overwriting merge. |

Other exact A1 gaps: Highlight/Draw state remembers options during the mounted editor but not across sessions (`src/HighlighterTools.tsx:18-20`); folder tree Left/Right/Home/End pattern is absent because folders currently use disclosure buttons, not a full tree widget; arbitrary note-title edits autosave rather than use Enter-confirm/Escape-revert; duplicate names and max-length feedback need policy/field validation. These fail the specified preferred contracts, but do not automatically make the core button/editor flow inaccessible. A virtual note-list optimization is NOT justified until the500-item profile identifies a need.

Conflicting requirements are resolved as follows. Keep the project’s irreversible permanent-delete confirmation; implement Undo for reversible structure operations, and decide Trash separately. Keep contrast-safe semantic palettes before unrestricted custom colors. Keep instant theme/reduced-motion state changes; the checklist’s desire for animation does not justify decorative motion. Modal blur dismissal is inappropriate even though A0 lists blur among generic close causes. Native DnD owns its gesture; do not add snap momentum for folder transfer. A44px target is preferred for touch/pen, while WCAG2.5.8AA uses24px with defined spacing/equivalence exceptions. A2px focus rule is a project target; non-text contrast is the confirmed AA issue, while Focus Appearance2.4.13 is AAA. [WCAG target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

## 5. Motion audit

Values below are inspected implementation values, not measured settle times. Later CSS overrides take precedence over legacy keyframes. Runtime smoothness, press latency and60fps performance are NOT VERIFIED unless a specific selected test is cited.

| Transition | Current duration / easing / properties | Verdict | Recommended value |
| --- | --- | --- | --- |
| Button press/release | Press0ms;1px down+active fill. Return/background/color/shadow160ms default ease (`styles.css:177-189`). | Immediate press provision PASS; measured response latency NOT VERIFIED. | Press highlight0ms; no reduced-motion translation. Return optional m1/k500/d45, no bounce. |
| Sidebar reveal/collapse | Grid columns/gap230ms ease; opacity/visibility170ms default ease (`styles.css:378,410`). | Final states tested; live reversal/FPS NOT VERIFIED. Animates layout. | One coordinated layout owner; m1/k300/d35, clipped left transform; reduced motion final layout instantly. |
| Reference reveal/collapse | Same grid230ms plus panel visibility; narrow absolute overlay. | Width/reference tests pass selected states; frame reflow NOT VERIFIED; F12. | Same spring from right, measured responsive width, no document scaling. |
| Focus enter/exit | Coordinates shell panel-state change through grid transitions. | Selected Focus tests pass stable state/editor identity; mid-flight momentum NOT VERIFIED. | Same panel controller, both sides retarget immediately; instantly settle under reduce. |
| Settings startup switch | Exact overdamped JS spring m1/k500/d45; px/s live velocity; measured travel (`useSwitchSpring.ts`). | Source PASS runtime reduced-motion observer and cleanup; subjective feel NOT VERIFIED. | Retain existing controller; do not add a second transform owner. |
| Action popover entry/exit | Entry opacity100ms default ease; no transform keyframe; immediate conditional unmount on exit (`styles.css:2183,2274`). | Exit FAIL F21; latency/frame origin NOT VERIFIED. | Opacity100ms entry/exit with live presence; optional4pxY/.98scale spring m1/k400/d40, no bounce. |
| Radix select entry/exit | Opacity100ms; portal/popover placement. | Entry provision; exit lifecycle NOT VERIFIED rather than assuming Radix behavior. | Same100ms opacity; retain collision placement. Inspect exit DOM before changing. |
| Dialog/scrim entry/exit | Effective opacity100ms; legacy modal200ms/fade180ms keyframes overridden at 2277; conditional exit immediate. | Exit FAIL; replacement focus F09. | Opacity100ms; optional8pxY/.98scale m1/k400/d40; reduced instant or opacity≤100ms. |
| Image-preview entry/exit | Modal family; separate z180; conditional removal. | No retained exit; full runtime NOT VERIFIED. | Same shared modal presence/ownership, retain sharp image/content. |
| Excalidraw context menu | Opacity/colors100ms in board.css; no app keyframe; reduced transitions none. | Selected context keyboard/viewport checks pass; exit frames/blur NOT VERIFIED. | Match app small-surface100ms opacity; keep engine ownership. |
| Engine Help modal | `animation:none`,opacity1. | Deliberately instant; runtime Help coverage NOT VERIFIED. | Instant is acceptable; make entry/exit policy explicit. |
| Folder disclosure | Child conditional mount/unmount; caret rotation rather than height presence. | Persistence/drag-hover fail; jump/reversal NOT VERIFIED. | Caret m1/k300/d35 from live angle; child reveal short optionalopacity; reduced instant. |
| Toast | Legacy toast-in200ms ease,8pxY plusopacity;3s lifetime; immediate removal. | Duration different from effective dialogs; dismissal FAIL; F11. | m1/k400/d40,8pxY retaining horizontal center+100msopacity; reduced instant; severity-dependent lifetime. |
| Note→note | Editor contents updated by note state; no documented page animation. | Selection/identity subsets pass; scroll policy/flash NOT VERIFIED. | Instant content commit; preserve intentional per-note scroll; no text scale or crossfade while typing. |
| Note↔board | Different editor surface; no measured transition duration. | NOT VERIFIED. | Instant semantic switch or≤100msopacity; no extra animation before editor is usable. |
| Theme / System startup | Theme tokens update; launch/system frames not recorded. | All-size Light/Dark screenshots taken; launch flash NOT VERIFIED. | Intentional instant theme is preferred; apply before first meaningful paint. |
| Save status | Text/icons state-driven; no measured reserve-width behavior. | Acknowledgement/retry source and browser recovery provisions; layout shift NOT VERIFIED. | Reserve status width; instantaneous truthful label, no per-keystroke celebration. |
| Checklist tick / list reorder | No dedicated verified transition; native drop commits array order. | NOT VERIFIED; do not infer a missing state affordance. | Tick micro80–120ms optional; reorder instant or quiet≤150msposition if stable, reduce instant. |
| Panel/image resize | Direct pointer tracking, captured pointer, cancellation; no release snap targets. | Selected panel-resize tests pass; image/FPS/native pointer behavior NOT VERIFIED. | 1:1 tracking; no momentum/snap spring required. Keep non-drag controls F05/F06. |
| Animated icons |450ms hover/focus icon animation; JS runtime reduced-motion subscription. | Causal-purpose FAIL F42; within 500ms but long for routine feedback. | Prefer static regular Phosphor plus immediate fill response. |
| Loading spinner |1s linear infinite (`styles.css:1684`). | Appropriate continuous-progress exception to “no linear UI”; actual delayed loading/startup NOT VERIFIED. | Retain only with readable status; stop under reduce, no loss of loading label. |

Proposed tokens: `--motion-feedback:100ms`, `--motion-surface:150ms`, `--motion-layout-fallback:230ms`, `--motion-opacity:100ms`; `--ease-enter:cubic-bezier(.2,.8,.2,1)`, `--ease-exit:cubic-bezier(.4,0,1,1)`, `--ease-color:cubic-bezier(.4,0,.2,1)`. Use these for non-gesture opacity/color/presence. For properties requiring reversal, use the stated physics controller instead of layering a timed transform transition under it. “230ms fallback” is not a claimed spring settle duration.

**A. Feel audit (project format).** Response latency: **[NEEDS INPUT]**, no pointer-down paint timing. Directness: **4/5** for browser-tested panel tracking/cancellation, native/image behavior untested. Interruptibility: **[NEEDS INPUT]**, final-state tests do not measure continuity/velocity. Spring behavior: **[NEEDS INPUT]**, switch controller inspected but no feel recording; native sidebar DnD snap/inertia **N/A**. Spatial consistency: **3/5**, pointer origin discrepancy/narrow Reference overlap, successful viewport-bounded palette tests. Materials: **4/5** for observed solid reading/chrome and theme contrast samples; nested/forced-color depth untested. Reduced motion: **4/5** for adapted palette and selected engine-context browser checks; full engine/native/runtime preference-change walk untested. These are scoped judgments, not a whole-screen verified5.

**B. Interaction redesign: Reference toggle.** Pointer-down shows the active press fill; click/Enter/Space commits pressed state and the existing Reference state. Reveal from the right to the current breakpoint/measured width, with one controller coordinating editor geometry. Do not recreate Tiptap, move its caret or steal writing focus. A second click during travel retargets from live position/velocity. When hiding a focused Reference, move focus to its toggle or editor before setting inert; re-entry restores interaction immediately, not after a timer. At narrow width use the explicit support-panel policy in F12. Reduced motion commits final layout immediately. Edge rubber-band and velocity projection are **N/A** for this button-triggered panel.

**C. Motion spec.** Panel position uses m1/k300/d35, Sidebar left/Reference right, no bounce, measured widths/gaps. Menu/dialog optional position uses m1/k400/d40; origins are trigger-facing and center respectively; start4px/8px down and.98scale, finish0/1. Opacity100ms independent and retargetable. Button return m1/k500/d45; press starts instantly. Rotation m1/k300/d35. Velocity units are CSSpx/s; retain live velocity on retarget. No gesture-driven CSS keyframes or fixed-duration release transforms. Native DnD transfer chooses exact valid targets, never velocity projection. Existing free-width resize needs no snap/inertia. If a custom snapped drag is later required, use recent80ms velocity sampling, projection `releasePosition + velocity * .2s`, pointer capture after≈10px recognition, and documented cancellation/bounds; that is proposed future behavior, not a current feature. Layout is the one exception to transform/opacity preference: editor geometry must resize without scaling text. Replace the existing grid230ms transition when adding the measured layout controller; profile layout work and keep one owner.

## 6. Design-system gaps

| System | Inspected gap | Concrete correction |
| --- | --- | --- |
| Type |11px helpers; fixed12px logo count/labels not tied to text scale; actual150% clipping untested. | Use secondary12px/body14–16px tokens scaled by text preference. Preserve user note font; test fixed virtual-row geometry before increasing text. |
| Spacing | Numerous literals;69px hover title change; minimum-height sidebar budget fails. | Tokenize4/8/12/16/24/32 increments where existing geometry supports them, reserve row action width, add short-height density. Do not force every current margin onto a grid without measured benefit. |
| Color | Semantic palette/muted samples pass; --line was reused as a focus indicator and fails contrast. | Separate --focus-ring from --line, map it to verified --accent, and provide forced-colors tokens. Do not classify authored artwork colors as theme chrome. |
| Radius | Existing25px panels/topbar,23px dialog and32px window are meaningful; maximized0 remains a native test. | Preserve these semantic geometry tokens and derive new controls from neighbors. No radius redesign. |
| Elevation/layers | Select150, action60, modal100, toast120, preview180. Toast is declared above modal, contrary to requested ownership order; actual overlap combinations untested. | Define layer tokens and allow nested menu above its modal, modal above ordinary toast, fullscreen preview as explicit modal owner. Verify actual stacking contexts; do not simply swap numbers globally. |
| Motion | Scattered100/160/170/200/230/450ms and dormant keyframes; exit presence absent. | Use section 5 tokens and explicit presence/lifecycle ownership; keep JS runtime reduced-motion observation. |
| Icons |Lucide animated app icons plus regular Phosphor. | Return routine app chrome to existing Phosphor. Engine artwork/tools may stay engine-owned but need labeled controls. |
| Control contracts | AppSelect consistent custom select, ActionPopover labeled action dialog; divergent item actions and incomplete trigger ownership. | Share descriptors, initial/return focus, IDs, expanded states and disabled reasons. Action dialogs containing inputs are valid dialog patterns; do not blindly relabel them menu/menuitem. |
| Notifications | String-only notice cannot express severity/action/lifetime. | Typed notice object with persistent error, optional action and bounded queue; keep save status owned by persistence. |

**D. Materials and hierarchy (project format).** Document and Reference content stay solid `--panel`/text surfaces. Sidebar/topbar retain existing solid tinted `--sidebar`/`--chrome`, quiet border and `--shadow`; writing remains primary. Floating actions use solid `--panel` and restrained theme-aware shadow; no nonmodal scrim. Dialog keeps solid panel, tinted dim backdrop and existing8px backdrop blur; do not animate the fullscreen blur. Theme-aware borders/shadows and reduced-transparency solid fallback remain required. Optional tinted translucency should only be considered for small floating chrome at 90–96%opacity/8–12pxblur with verified contrast, not stacked over document text. No new material is implemented by this audit. Live runtime dark colors are warm brown/gold, unlike the guidance’s cool-blue wording; preserve the current validated semantic theme and resolve any brand change separately **[NEEDS INPUT]**, rather than silently recoloring it.

## 7. Prioritized fix list

Order uses a coarse benefit/effort rubric rather than invented hours: impact1–5 divided by S=1, M=2, L=4; ties put AA/core-writing fixes first. S/M/L are relative, not guaranteed time estimates.

| Rank | Fix | IDs | Impact/effort | Release reason |
| ---: | --- | --- | --- | --- |
|1| Correct shared select focus contrast and forced-color indicator | F01 |5/1=5| Repeated AA focus failure. |
|2| Name board main-menu trigger | F02 |5/1=5| Proven4.1.2 failure; small patch. |
|3| Add click reorder actions | F04 |5/1=5|2.5.7 gap for navigation structure. |
|4| Add click/numeric panel width controls | F05 |5/1=5|2.5.7 gap in both panels. |
|5| Add non-drag image width control | F06 |4/1=4|2.5.7 gap for document images. |
|6| Restore focus on modal content replacement | F09 |4/1=4| Reproduced body-focus destination. |
|7| Recover useful sidebar list height at 850×600 Large | F03 |5/2=2.5| Core navigation has only a sliver of row space. |
|8| Make modal background inert and contain portal focus | F08 |5/2=2.5| Reusable dialog contract/release screen-reader gate. |
|9| Preserve native selected-text edit commands | F07 |4/2=2| Daily writing context path loses basic commands. |
|10| Keep errors actionable until resolved | F11,F37 |4/2=2| Failures otherwise vanish with success styling. |

Follow next with F10 structural Undo, F14 search keyboard path and F36 export guard; their lower table position does not waive the stated release conditions. Feature additions in section 4 require scope decisions and do not outrank the confirmed control fixes.

Quick wins plausibly under 1hour each, assuming one focused code change plus an existing browser check: F01 select focus border; F02 board-menu name through the existing patch route; F22 initial Cancel focus; F23 folder field focus/select-all; F26 named/count removal wording; F27 board terminology; F37 severity glyph; F38 truthful download wording; F39 helper token. F41 current maximize name/glyph is also small, but native validation is extra. This is an estimate, not a measured development duration.

**E. Implementation checklist (project format; proposed work).** Reuse app state, tokens, regular icons, breakpoints and existing mutations. Keep pointer-down feedback immediate without premature activation. Preserve active editor identity, selection, scroll, shortcuts, read-only Reference and acknowledged save/error semantics. Give each animated property one owner with live reversal/cleanup. Keep native sidebar DnD; add pointer alternatives rather than replacing it. Use runtime JavaScript reduced-motion listeners for springs and CSS/reduced-transparency fallbacks for materials. Validate rapid toggles, Escape/reopen, owner focus, selection/scroll, Light/Dark/System, minimum/wide and native maximized states. For actual frontend changes run `npm run build` and relevant inspected behavior suites; do not treat a test script’s existence as coverage or write tests that merely copy token constants. Every repaired finding needs an outcome assertion, not only a screenshot of source.

**F. Screen-specific do/don’t (project format).** Keep immediate Sidebar/Reference/Focus reversal, correct ellipsis/cursor origin, visible formatting state, truthful persistence feedback and quiet solid reading surfaces. Do not bounce text/destructive confirmations, capture editor scrolling for panel gestures, delay toggles until an exit completes, stack glass, add typing sounds, remount the active editor or trigger saves from animation callbacks.

## 8. Retest plan

The audit is complete as an evidence review with explicit unknowns; native/screen-reader/performance outcomes are **NOT VERIFIED**. No additional screenshot can prove keyboard speech, OS file behavior or smooth motion. Use the following exact capture sets. Each NOT VERIFIED ledger cell has `needs`; apply its per-surface/check requirement plus the matching set below. This covers the remaining A0 matrix and every B–G/state unknown without assuming a shared component guarantees every consumer.

| Set | Exact tools, actions and captures | Turns these unknowns into PASS/FAIL |
| --- | --- | --- |
| R1: environment/control-state census | Installed Windows11/WebView2 build at the audited or fixed commit; record version, GPU, display refresh, OS scale and text scale. For Light/Dark×Small/Medium/Large take850×600 and1280×720 states; add1920×1080,2560×1080, actual maximized and half-snapped. Repeat OS scaling100/125/150/200%, plus System theme changes. Enumerate all controls in control-state-ledger and engine-generated descendants; capture default/hover/focus-visible/pressed/selected/disabled/loading/error/empty or mark genuinely impossible states N/A with reason. Capture bounding boxes and adjacent target spacing, measured CSS pixels; preserve24pxAA exceptions correctly, check44px touch preference separately. | All target-size/state/cursor/layout/theme/text-size cells; E1–E7 and D density/spacing. |
| R2: every-trigger keyboard/pointer matrix | For each94surface records: click its trigger, capture trigger+surface+accessibility tree; record focus, ArrowUp/Down/Home/End, Enter/Space, applicable typeahead/LeftRight, Tab/ShiftTab; try each close cause separately, reopen rapidly20times, and inspect orphan count/owner focus/range. Open at all four corners; resize/theme/text-size while open; scroll popup to both ends and adjacent pane to detect bleed. Test nested font/category/template/direction selects, menu→dialog, Settings→Shortcuts, image preview and every engine tool/style/library/help/Moretools/mainmenu/context action. Use Playwright traces/videos and devtools DOM/computed styles, not only static images. | Remaining A0 trigger/placement/navigation/owner/layering/close/focus/rapid-reopen cells and F keyboard order. |
| R3: actual assistive technology | Run Narrator and NVDA in installed WebView2 (separate sessions). Provide speech log/audio plus keystrokes/video. Traverse Sidebar/main/Reference landmarks, headings/title, all trigger state changes, selected/disabled values, logo filtered count/active position, error association, save status, toasts and nested dialogs. Try browse-mode traversal of background during modal and focus starting outside; Tab/ShiftTab full loops. Expected: active modal excludes background, every button named, no body focus destination, counts/status updates spoken without stealing editor focus. | A0 final announcement cells, F1/F2/F3/F6/F9/F10 and modal inert/focus outcome. Accessibility-tree labels alone do not substitute for speech. |
| R4: motion/latency profiling |60fps-or-higher recording and Chromium/WebView2 Performance trace with screenshot frames. Measure pointer-down→first painted feedback, trigger→usable surface, close retention, current values at reversal. Toggle Sidebar/Reference/Focus after 50/100/150ms during travel; repeat modal/menu close→reopen and switch direction mid-flight. Capture selection/caret and scroll throughout. At Large with 187+notes profile frame times/layout costs; report hardware, sample count, long frames and actual FPS. Test live reduced-motion change while a JS spring and engine overlay are running; repeat every section 5transition including tick/reorder/loading/startup. | B purpose/latency/duration/reflow/FPS/choreography/interruption/reduced-motion and project feel-score unknowns. |
| R5: forced colors/zoom/international content | Windows High Contrast light/dark variants; browser200%zoom and OS text sizing independently. Long titles/folders, unbroken200-character token, emoji, Arabic/Hebrew RTL and CJK notes. Capture focus/selected/disabled/error states at all edges, with logo count/labels and code hints. Fill notebooks with 1/50/187/500synthetic items; use500only in a separate seeded profile. Capture scrolling/tool access rather than just static viewport. | F7/F8, D2/D3/D6/D8, long-label/clipping, focus ring overflow, virtual item stability and text-scale unknowns. |
| R6: desktop file/storage/failure paths | Use disposable test notebook/database copies. Record native import/save dialogs, stated type filters, cancel at chooser/progress stages; valid/corrupt/password/OCR PDF,DOCX/text, oversized and mixed files, corrupt backup, merge ID collision and partial failure. Inject export permission failure/disk-full/save failure/revision conflict; capture pending→success/failure/Retry and verify actual persisted/exported content. Test Alt+F4 during pending save and failed save, PostgreSQL missing/busy/corrupt startup, offline/missing WebView2 installer and recovery instructions. Never delete user notes to test safety. | Native A1.16/G4/G6, error association, cancel/late-callback/double-submit/export acknowledgement, installed storage/recovery. |
| R7: native drag/resize/gesture outcomes | Explorer→folder/editor batch drop, image drop/paste, native note/folder reorder and transfer at insertion edges/collapsed folders. Capture native preview/grab offset/invalid target/autoscroll/Escape/blur and item focus; verify final persisted order. Panel/image resize with mouse/pen,10px recognition, pointer capture/lostcapture/blur/Escape/viewport changes, keyboard increments/bounds/reset/reload and added click alternatives. Do not fling native folder transfers. | A1.14/A1.17, F2.5.7 fixed outcomes, real WebView2drag routing and directness; cancellation must make no unintended commit. |
| R8: native text/context/shortcuts | Select ordinary text and run right-click/ShiftF10/Menu key; record native Cut/Copy/Paste/Spellcheck in note/title/caption/code/Reference and custom image actions. Test link Ctrlclick/Enter/context and actual opening destination. Run CtrlK/CtrlEnter/CtrlSlash/Undo/Redo/Focus and board-engine shortcuts with OS conventions; hold/rapid-repeat and try IME composition. | Native context capability, link following, all shortcut conflicts/documented hints and editor selection/caret restoration. |
| R9: long-list/first-run/disclosure | Clean-profile first launch and genuinely empty notebook; start with no empty Reference surface. Expand/collapse/folder switch/reload; find Archive/Unfiled. Logo picker load failure/Retry, filters, no match, many selections,7,387catalog search, keyboard grid crossingvirtual rows, scroll far→close/reopen. Capture result speech and stable selected/focused states. Test note title/caption/folder validation and dirty cancellation. | G1/G2, A1.12/A1.13/A1.18, count/scroll/persistence/state unknowns; product absent features remain FAIL/N/A by explicit decision. |
| R10: timing/content/layers | Measure installed cold start and note→note/note→board/search latency across fresh/warm runs (at least10each; report median/p95 and notebook size). Record first frames for theme/loading flash. Show error notices while hovered/focused, multiple successes/errors, copy fallback, backup age threshold and backup cancel. Open nested menu/select from modal while a toast exists; inspect actual stacking/critical-control coverage. Inventory displayed titles/buttons/hints/empty copy across note+board. | G3/G7, B loading perception, D4/D7, A0z/tooltip/status timing, backup threshold and notifications. |

Browser regression after code fixes: start only this checkout on an unused port; prepare logo assets; run `npm run build`; run the relevant existing menu-exclusivity, permanent-delete, focus-mode, sidebar/reference-resize, selection-color, brand-logo, board-context-menu and recovery suites with reviewed fixtures. Inspect available image-block/highlighter/drawing/board-export/board-saving/file-import/sidebar-drag suites for the corresponding changed paths before adding tests. Maintain an audit fixture adapter separately until stale source tests are intentionally corrected; report unmodified and adapted results separately. F01 needs measured contrast/forced-colors outcomes; F02 needs rendered-name outcome; F04–F06 need a pointer-only operation; F03 needs visible navigable rows at minimum height; F07 needs actual native edit commands; F08/F09 need modal traversal/focus; F10 needs structural Undo without overwriting new content; F11 needs persistent actionable failure. These are release outcomes, not token-constant assertions.

Source-only background notes: [shell evidence](D:/Projects/work-essential/audit/shell-evidence.md), [editor/board evidence](D:/Projects/work-essential/audit/editor-board-evidence.md), [safety evidence](D:/Projects/work-essential/audit/safety-evidence.md). The final findings above supersede speculative candidate findings in those notes. A final safety-subagent review checked cited file existence and qualified F08/F41 to avoid overstating untested native behavior. [ARIA APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) supports focus/inert expectations; [APG menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) supports trigger ownership where an actual menu pattern is used.
