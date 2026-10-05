# Verification history

## Scribly 1.3.18 installer, 2026-10-05

Editor changes and synchronized npm/Tauri/Cargo version metadata committed as `3ecb38b`. Build input is that revision plus the pre-existing, uncommitted cleanup (including removal of unused attachment-size helpers and generated logo reporting); cleanup was preserved and excluded from the editor commit.

- `npm.cmd run package`: passed. Runs the frontend TypeScript/Vite build, optimized native release compilation and NSIS x64 packaging through `scripts/build.ps1`. Existing Vite large-chunk advisory remains.
- Installer: `release/Scribly_1.3.18_x64-setup.exe`, 61,061,845 bytes. SHA-256: `05A140B8CAA9213A9AD5E9FA32FA1F03023C1EF94681EC2021AA8EF8639A1F55`.
- Staged diff check passed. No tests, installer launch or installation performed, per the user's manual-validation preference. Installer is local; not published or pushed.

## Easier pen shortcuts, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx` and `src/HighlighterTools.tsx`: replaces Ctrl+Alt+P/H with Ctrl+D for pen and Ctrl+G for highlighter. Tooltips and aria-keyshortcuts match. Other modifiers are excluded; the existing editable-note scope, toggle behavior, focus preservation and dismissal of open options remain.

- Scoped `git diff --check`: passed. Final `npm.cmd run build`: passed, with the existing Vite large-chunk advisory.
- No tests or screenshots run, per the user's manual-validation preference. Shortcut behavior remains for manual validation.

## Pen and highlighter shortcuts, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx` and `src/HighlighterTools.tsx`: Ctrl+Alt+P toggles pen; Ctrl+Alt+H toggles highlighter without opening options. Tooltips and aria-keyshortcuts expose both. Shortcuts apply within the editable note panel, excluding inputs/dialogs, repeat, composition and AltGraph; focus is preserved without scrolling. Handled events stop propagation so Ctrl+Alt+H cannot also trigger the app's Ctrl+H handler. Reference is excluded.

- Scoped `git diff --check`: passed. `npm.cmd run build`: passed, with the existing Vite large-chunk advisory.
- No tests or screenshots run, per the user's manual-validation preference. Keyboard behavior remains for manual validation.

## Separate pen options triggers, 2026-10-05

Working tree based on `98f5285`, scoped to `src/HighlighterTools.tsx` and `src/styles.css`: pen/highlighter icons toggle their tool without opening options. Each has a compact, separately labeled dropdown arrow with expanded/dialog semantics, anchoring its own popover and toggling it independently. Dropdown opening selects that tool's remembered settings without activating an idle drawing session. Existing toolbar measurement includes the wider controls.

- Scoped `git diff --check`: passed. Final `npm.cmd run build`: passed, with the existing Vite large-chunk advisory.
- No tests or screenshots run, per the user's manual-validation preference. Click, keyboard and responsive behavior remain for manual validation.

## Annotation side margins, 2026-10-05

Working tree based on `98f5285`, scoped to `src/InkLayer.tsx` and `src/styles.css`: drawing/highlighting extends up to 32px times the appearance scale on each side of the text column, bounded symmetrically by available panel space with an 8px edge inset. Text remains at its existing measure. Saved and preview geometry uses the expanded SVG bounds while persisted block-relative coordinates remain unchanged. Resize observation includes the scroll panel so capped text columns update their annotation margins when the panel changes size.

- Scoped `git diff --check`: passed. Final `npm.cmd run build`: passed, with the existing Vite large-chunk advisory.
- No tests or screenshots run, per the user's manual-validation preference. Margin drawing, persistence/reload and native pen behavior remain unverified at runtime.

## Pen popover headings and status cleanup, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx`, `src/HighlighterTools.tsx` and `src/styles.css`: removed the drawing/highlighting status row and Return to writing label; toolbar active states and Escape behavior remain. Added subtle Size and Color headings with a thin theme-token divider between the popover sections.

- Scoped `git diff --check`: passed. Final `npm.cmd run build`: passed, with the existing Vite large-chunk advisory.
- No tests or screenshots run, per the user's manual-validation preference. Visual appearance and browser interaction remain for manual validation.

## Compact pen/highlighter popovers, 2026-10-05

Working tree based on `98f5285`, scoped to `src/HighlighterTools.tsx`, `src/NoteEditor.tsx` and `src/styles.css`: separate pen/highlighter buttons choose one active tool and open their own compact, two-row popover. Visual sizes and three colors replace labels/pixel values; a straight-line icon sits in the size row. Drawing smoothing is always enabled. Shortcut hints are tooltips. The text-selection highlighting action is removed from this drawing menu; selected-text color controls remain available in their existing palette. Clear is a subdued trash icon with a separately bounded Undo transaction.

Per-tool size/color/line preferences belong to the editor, surviving toolbar reparenting/collapse, and are cached in `scribly-pen-choices-v1` with bounded option validation. Preferences remain usable in memory when local storage is unavailable. The writing-status text uses “Straight line” rather than “Guided”.

- User's manual-validation preference remains active: no automated browser tests, screenshots or new test cases. Scoped `git diff --check` passed. Runtime popover behavior, actual pen-device feel and preference reload are not verified by this pass; older tool-menu test assumptions do not validate the redesigned controls.
- Final `npm.cmd run build`: passed; existing Vite large-chunk advisory remains. Compilation/bundling only; no UI tests run.

## Wider column and combined pen selector, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx`, `src/HighlighterTools.tsx` and `src/styles.css`: reading measure is 80ch; toolbar Undo/Redo buttons are removed while keyboard commands remain; a single pen toggle shows the selected Highlight/Draw tool with selection and settings in its dropdown. Tools retain their individual stroke choices during selection changes. The toolbar measures its primary/secondary controls and collapses only when they exceed its available width; Large appearance alone no longer forces collapse. Inline secondary tools do not wrap.

- User explicitly requested no tests and will validate the preview manually. No automated browser tests or new test cases were run/added for this change. Earlier toolbar/pen test assumptions describe the old buttons and are not evidence for this new arrangement.
- `npx.cmd tsc --noEmit`: passed before the final spacing refinement. Scoped `git diff --check`: passed.
- Final `npm.cmd run build`: passed; existing Vite large-chunk advisory remains. This was compilation/bundling, not a browser test run.
- Browser interaction and native pen feel remain unverified for this change. The existing development preview receives these edits through HMR.

## Unified editor controls, 2026-10-05

Working tree based on `98f5285`: `NoteControls.tsx`, `NoteEditor.tsx`, `NoteFind.tsx`, `textSearch.ts`, shared icon/select controls, Backlinks in `App.tsx`, and related CSS. Replaces the earlier floating-toolbar treatment with a full-panel, solid pinned strip containing formatting and Find/Replace. Footer controls retain their layout and actions.

### A. Feel audit

Browser observations in installed Edge: response 4/5 (normal press/click semantics; icon press does not activate early), directness 4/5 (native scrolling and explicit More expansion), interruptibility 4/5 (retargetable CSS disclosures; no animation lock), spring behavior N/A (no gesture physics added), spatial consistency 5/5 (strip fills panel interior, content-aligned controls), materials 4/5 (solid content and strip; faint pinned divider/shadow), reduced motion 4/5 (no sliding under the runtime preference). These are bounded browser observations, not native performance scores. [NEEDS INPUT] Physical WebView2/display smoothness remains unmeasured.

### B. Interaction redesign

Undo/Redo, fixed-width text style, Bold, Italic and Find remain reachable. Narrow/Large layouts expose secondary commands through More. Ctrl+F prefills the editor selection; Ctrl+H reveals Replace; Enter/Shift+Enter navigate; Escape restores the opening bookmark and scroll. Match positioning accounts for the entire strip and footer. Replace all is one undo step; its inline Undo clears after a later document edit. Empty Backlinks are omitted, while linked-note navigation is retained.

### C. Motion specification

Find, Replace and More use a 0fr/1fr grid expansion, opacity and -4px/0 translation: 180ms entry and 120ms exit, ease-out. Reduced motion removes translation and uses short opacity only. The strip's pinned shadow fades over 160ms without position, radius or material changes. Sidebar/Reference use their existing coordinated grid layout with 180ms easing and short directional reveals; this layout-animation exception is retained, not a new spring. Menus enter over 160ms and existing dismissal remains immediate. Bounce, release velocity, inertia and custom gesture keyframes are N/A. Shared control icons are static regular Phosphor icons, preserving the existing wrapper contract.

### D. Materials and hierarchy

Document and strip share solid `--panel`; floating popovers use solid `--chrome`, with a lighter dark-theme chrome level. Thin semantic borders and the existing blue/tan accents remain. Find matches use a neutral soft fill, with stronger current-match fill and accent outline; no-result counts use warning text. Inputs/buttons keep one small-radius family and visible inset focus outlines. The footer fade has no hit targets and tracks the actual footer height; note bottom padding leaves the final line room.

### E. Implementation and validation

- Final `npm.cmd run build`: passed; existing Vite large-chunk advisory remains. Scoped `git diff --check` passed. Impeccable detector reported only the existing unrelated code-block accent-border warning.
- `npm.cmd test -- tests/note-controls.spec.ts tests/retrieval.spec.ts tests/icon-motion.spec.ts --grep 'strip remains|selected text shortcuts|large-note|Shared Phosphor' --workers=1`: 6 passed (34.4s), including responsive Large layouts, selected-text shortcuts, unobscured navigation, inline Undo, Escape/reduced motion, all 1,800 match decorations and static icon action timing.
- Final wrapper correction: `npm.cmd test -- tests/note-controls.spec.ts tests/icon-motion.spec.ts --grep 'strip remains|Shared Phosphor' --workers=1`: 4 passed (22.8s), including visible image/highlight/draw icons. This overlaps the preceding run and is not added to it.
- `npm.cmd test -- tests/connected-workflows.spec.ts tests/icon-motion.spec.ts --grep 'derived backlinks|cancel restores selection|remaining .*sidebar and formatting' --workers=1`: 4 passed (33.5s), covering nonempty Backlinks, linked-note/Reference selection preservation and both-theme toolbar/sidebar icon hover without editing.
- Focused retrieval group also passed match counting/navigation, formatting-preserving Replace all/Undo/Redo, single replacement/deletion, archived/Trash read-only Find, and replacement preserving image/ink through reload. Focused shared-control group passed keyboard focus, menu/Reference/Settings/board command hover, six menu ownership cases and panel focus restoration.
- Initial runs exposed stale checkbox/empty-count assumptions and an outer-border geometry comparison, corrected against the requested UI semantics. Two accidentally overlapping runners collided in the same trace directory: one large-note case and two static-icon cases reported ENOENT during context cleanup. All three passed independently in the six-case follow-up above. Do not treat overlapping runs as separate unique coverage or the trace collision as a product defect.
- Light/default and dark/narrow-Large screenshots inspected; a hidden icon wrapper was corrected and checked. Disposable screenshots removed. No native rebuild, broad regression suite, screen-reader audit or sustained performance claim.

### F. Screen-specific decisions

Keep writing primary, the strip solid and flat, Find on the right, secondary tools reachable through More, match outlines and truthful save state. Preserve the editor instance, native scrolling, read-only restrictions, normal click activation and existing footer actions. Do not bounce or animate control icons, capture document gestures, leave hidden Find/More controls interactive, or defer editing/saving to animation completion.

## Clearer pinned toolbar separation, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx` and `src/styles.css`: moved sticky ownership to a shell with an 8px solid, noninteractive gutter so passing text is separated from the toolbar. Pinned toolbar uses existing chrome/line tokens, a stronger shadow, and padded rounded edges. Appearance retains 180ms transitions and instant reduced motion; layout is not animated.

- `npm.cmd run build`: passed; existing Vite large-chunk advisory remains.
- `npm.cmd test -- tests/ux-critique.spec.ts --grep 'readability, one-row toolbar' --workers=1`: 2 passed (14.9s), covering light/dark desktop/minimum-width controls and reduced motion.
- Disposable `node --input-type=module` Playwright/installed Edge checks: pin/unpin restores state in both themes; pinned corners reach 12px and solid gutter opacity reaches 1; narrow toolbar scrolling exposes Find, Escape dismisses Find, runtime reduced motion yields 0s transitions. Both theme screenshots inspected and removed. Native WebView2 performance remains unmeasured.
- Scoped `git diff --check`: passed. Impeccable detector reported only the existing unrelated accent-border warning.

## Find/Replace content width, 2026-10-05

Working tree based on `98f5285`, scoped to `src/styles.css`: Find/Replace shares the note title/toolbar/editor reading measure and centered alignment; child controls retain their 13px scaled text size.

- `npm.cmd run build`: passed; existing Vite large-chunk advisory remains.
- `npm.cmd test -- tests/retrieval.spec.ts --grep 'Find counts' --workers=1`: 1 passed (7.7s), covering match navigation and Escape preserving caret, scroll, and editor identity.
- Disposable `node --input-type=module` Playwright/installed Edge geometry check: identical Find/Replace and content left edges/widths at 1440px and 850px viewports in light/dark themes; Replace all stays in viewport and input font remains 13px. Screenshot inspected and removed. Native WebView2 not retested for this CSS-only change.
- Scoped `git diff --check`: passed. Impeccable detector reported only the existing unrelated accent-border warning.

## Sticky note toolbar depth, 2026-10-05

Working tree based on `98f5285`, scoped to `src/NoteEditor.tsx` and `src/styles.css`: an IntersectionObserver tracks the toolbar's original position; pinned appearance uses 12px scaled corners and the existing theme shadow, with interruptible 180ms appearance transitions and instant reduced motion. No layout or editor-position animation.

- `npm.cmd run build`: passed; existing Vite large-chunk advisory remains.
- `npm.cmd test -- tests/ux-critique.spec.ts --grep 'readability, one-row toolbar' --workers=1`: 2 passed (14.4s), covering light/dark desktop/minimum-width formatting access and reduced motion.
- Disposable `node --input-type=module` Playwright/installed Edge checks: scrolling pins/unpins, three rapid reversals restore the default class, settled light/dark corners are 12px and return to 0px, editor identity and selection survive scrolling, runtime reduced motion yields 0s transitions. Screenshot inspected; disposable screenshots removed. Native WebView2 performance remains unmeasured.
- `git diff --check -- src/NoteEditor.tsx src/styles.css`: passed. Impeccable detector reported only the existing unrelated accent-border warning.

## Compact note footer, 2026-10-05

Working tree based on `98f5285`, scoped to `src/styles.css`: tightened footer and Backlinks spacing, retaining visible save/backup/export controls.

- `npm.cmd run build`: passed; existing Vite large-chunk advisory remains.
- Disposable `node --input-type=module` Playwright/installed Edge check against port 1420: footer measured 44px with 32px controls at 1440px and 850px viewport widths, no horizontal overflow under light/dark color-scheme preferences; export menu opened. Desktop screenshot inspected and removed. This was a geometry/menu check, not export-byte or native WebView2 validation.
- Impeccable detector on `src/styles.css`: only an existing unrelated accent-border warning at line 1082. No new motion or persistence behavior introduced; no broad suite or native rebuild run.

Last consolidated: 2026-10-05. This is the single maintained record of completed validation, known failures, and test selection. Read the relevant entry rather than repeating earlier work.

## How to reuse this record

- Historical results apply to the stated source snapshot and environment. Check the diff for the affected implementation, shared dependencies, configuration, and test harness before reusing a result. Retest changed critical behavior; an old pass is not a permanent exemption.
- Run selected tests with `npm test -- tests/<feature>.spec.ts` and, when useful, `--grep "case name"`. Set `PLAYWRIGHT_PREVIEW=1` only for production-compatible tests. Source-module/fault-injection checks need the development server.
- Use the existing ignored `test-results/` and `test-results-preview/` outputs. Summarize completed runs here and remove disposable outputs; keep a useful trace for an unresolved failure. Do not generate another audit/report directory.
- Record the date, source scope/revision, exact command, result, and limits in the relevant entry. Do not add overlapping pass counts or describe a failed broad run plus follow-ups as a single green run.
- Keep reusable behavioral specs and native diagnostic scripts. A passing test remains useful when its feature changes; completed screenshots, report generators, duplicate test copies, and obsolete harnesses do not.

## Repository cleanup: 2026-10-05

Working-tree changes based on `98f5285071b4b0442086f4f5937a8092a96c898a`: retired duplicate audits/reviews, obsolete branding generators/assets, an unreferenced fixture, and the unused whole-notebook size calculator plus its benchmark. Kept reusable feature tests, native diagnostics, current branding sources, runtime assets/licenses, and the unfinished roadmap. The attachment harness now resolves its live module through `storage.ts` and tests missing-image backup failure through the actual portable-backup path. Logo preparation no longer writes a disposable release report.

- `npm.cmd run build`: passed; existing Vite large-chunk advisory remains.
- `npm.cmd test -- tests/performance-enhancements.spec.ts --grep 'image migration|file-backed image nodes|delta save' --workers=1`: **3 passed in 35.9 seconds**. Covers migration/backup failure, delta acknowledgement, and image resize/Reference/Undo.
- Local Markdown link review: no missing targets. Runtime import traversal from `src/main.tsx`, including worker URLs: no remaining unreachable source modules (declaration files excluded). This is a static reachability check, not proof that every exported symbol or asset is exercised.
- No broad browser suite or native rebuild was run; native application code did not change. The existing Unfiled drag failure remains open.
- 91 tracked obsolete files removed from the checkout; roughly 14 GiB of old local outputs archived outside it. The archive is recoverable and has not freed disk space.

## Latest application baseline: 1.3.17, 2026-10-05

Built from `87f3d29699087277e477096c72543f5f00319481`; final consolidation/test-harness commit `98f5285071b4b0442086f4f5937a8092a96c898a`. These are imported historical results, not new executions during repository cleanup.

| Validation | Recorded result | Scope / limitation |
| --- | --- | --- |
| TypeScript/Vite, optimized Rust, NSIS | Passed | 408 recorded application/build inputs unchanged during packaging |
| Rust formatting / Clippy | Passed | Windows build; warnings denied |
| Rust unit tests | 36 passed | Versioned release checks |
| Database / recovery integrations | 5 passed | Isolated profiles, not the installed notebook |
| Optimized native database / WebView2 capture | Passed | Actual foreground shortcut and cross-process conflict were not repeated in 1.3.17 |
| Full development browser run | 292 passed, 24 failed, 3 production-only skipped | Preserve the initial failures; this was not a clean full run |
| Targeted follow-ups | 23 original failing cases subsequently passed; 315 distinct development cases passed across runs | Stale selectors, fixtures, and interactions repaired; overlapping groups not summed |
| Production-only cases / HTML-PDF export | 3 production-only passed; production HTML/PDF export passed | Not a full production-suite claim |
| Sidebar drag | 11 other sidebar cases passed; one unresolved | Moving into Unfiled and back hangs on the second native drag mouse dispatch; cause unconfirmed |

Latest retained installer: `release/Scribly_1.3.17_x64-setup.exe`, 61,078,675 bytes. SHA-256: `18A63624ACC1FA9DE4C9E4552800ECB1F12C050C17986545AC7981B76E39DB32`. It was built locally, not installed or published by that task. Its original build-input manifest and verification metadata remain under `release/build-1.3.17-20261005/` for exact provenance. Cleanup source edits are not included in this installer.

The unresolved drag's latest trace and error context are retained in `release/known-failures/unfiled-drag-1.3.17/`, with its runner log alongside. Retest this case when changing sidebar drag behavior; do not repeatedly rerun unrelated features to investigate it.

## Completed feature evidence and focused test selection

All entries below are historical. Counts belong to their own runs, often overlap, and must not be totalled. The retained specs are under `tests/`; native counterparts are under `scripts/test-native-*.ps1` where listed. Builds passed for the recorded final releases unless an exception is stated.

| Feature / source era | Evidence already recorded | Relevant checks when this behavior changes |
| --- | --- | --- |
| Quick capture, 1.3.16, Oct 4 | 4 browser checks passed together; 2 targeted Rust tests, format, final Clippy, optimized build/NSIS passed. Isolated WebView2 verified actual Explorer shortcut focus, one reused window, capability isolation, main draft/Reference preservation, Unicode, acknowledged Save/Open, failed-write retry without duplicates, close/restart recovery, and shutdown draft retention. Separate two-process shortcut conflict/release/reregistration passed. | `quick-capture.spec.ts`; `test-native-capture.ps1`, `test-native-capture-conflict.ps1` |
| Formatted note export, 1.3.15, Oct 4 | 5 focused cases passed across runs; only affected HTML/PDF and viewport cases repeated after correction. Current-draft ZIP, shared images, sanitation, multi-page Chromium PDF, cancellation and retry covered. Optimized WebView2 verified attachment reads, native HTML Save bytes, print cancellation and cleanup. Rust sources reused unchanged 1.3.14 evidence. | `formatted-export.spec.ts`; `test-native-formatted.ps1` |
| Connected notes/templates, 1.3.14, Oct 4 | Initial development group 69 passed / 4 failed; each failure later passed targeted follow-ups. Rust: 34 unit, 4 PostgreSQL integrations, plus 1 read-only check. Optimized WebView2 verified backlinks/Reference, template delta/reload, source purge retaining template assets, and original-inclusive backup/import remapping. | `connected-workflows.spec.ts`; `test-native-connected.ps1` |
| Retrieval/Find/Replace, 1.3.13, Oct 4 | Development 36 passed plus corrected visual case; final production 20 passed / 4 development-only skipped, including all 14 retrieval checks. Rust 33 unit / 3 PostgreSQL integrations. Fixed recent-ID delta validation against complete item order after native failure; targeted integration and optimized WebView2 passed. | `retrieval.spec.ts`; `test-native-retrieval.ps1` |
| Backups/history/Trash, 1.3.12, Oct 4 | Overlapping 24 menu/drag/deletion and 54 protection/storage/image/recovery checks passed; final production UI 12 passed / 4 development-only skipped. Rust 32 unit / 3 PostgreSQL integrations passed. Isolated debug and optimized WebView2 verified history reload/restore, Trash, exact original bytes, safety-copy replacement, conflicts and failed writes. | `protection.spec.ts`, `recovery.spec.ts`, `permanent-delete.spec.ts`; `test-native-protection.ps1` |
| Large files/storage, 1.3.12, Oct 4 | 69 relevant browser checks, 20 Rust unit and 2 isolated PostgreSQL tests recorded for the capacity phase. Optimized WebView2 imported a 25,160,014-byte XML with exact SHA-256, bounded 53,971-character view and annotation reload. One sample: 17,186 ms import / 78 ms next section; not sustained profiling. Later production original-inclusive backup checks passed 2 UI cases / 4 dev-only skipped, and the focused large-file/recovery group passed 21. | `large-files.spec.ts`; `test-native-large-files.ps1`, `test-database.ps1` |
| Published starter notebook, 1.3.12, Oct 4 | Separate public-release snapshot `595478959db06a4dd0742a080336a40bc8d25a4c`: production browser 27 passed / 4 dev-only skipped; Rust 18 passed / 1 ignored; format/Clippy/build/NSIS and isolated extracted-package database/starter preservation passed. Distinct from the later protection build sharing the version number. | `starter-notebook.spec.ts`, `finalization.spec.ts`, `recovery.spec.ts` |
| Public package, 1.3.11, Oct 4 | Snapshot `03e373827113f5dae8516972b621c159dcfbde70`: browser 25 passed / 4 dev-only skipped; Rust 18 passed / 1 ignored; build/NSIS, database checks on built and extracted executable, and native theme/taskbar icon checks passed. | Existing CI selection; native database/icon scripts for affected changes |
| Windows icons, 1.3.10 and earlier | Native HICON pixel palettes, Shell resource identity, Light/Dark/System, rapid reversal, reload and cached-handle reuse passed in isolated Windows profiles. Earlier focused browser icon checks and 2 Rust icon/bounds tests passed. Rendered taskbar appearance was not comprehensively inspected. | `app-icon.spec.ts`; `test-native-app-icon.ps1` |
| Rust architecture/boundary, 1.3.9 | Format/Clippy, 17 unit / 1 real PostgreSQL integration passed. Production run: 233 passed / 16 skipped / 1 folder timing failure; targeted 24 palette and 27 folder repetitions passed, giving 234 applicable scenarios across runs. Tested atomic writes, bounded IPC, conflicts, restart, locked-write timeout and failed-schema server cleanup. | `rust-boundary.spec.ts`; `check-rust.ps1`, `test-native-rust-boundary.ps1`; relevant Rust test filter |
| Board export flow, 1.3.8 | 69 selected production and 4 development cases passed; 4 dev-only production skips. Build/native/NSIS passed. Quick-copy, reviewable omissions, direction, repair links, Focus and save/clipboard failure coverage. | `board-export-flow.spec.ts`, affected `board-extensions.spec.ts` cases |
| Brand logos, 1.3.7 | 34 selected production checks passed; build/native/NSIS passed. Offline catalog, reversible insertion, failure/cancel, viewport fitting and exports covered. | `brand-logos.spec.ts` |
| Icon hover extension, 1.3.6 | 80 applicable production checks passed across affected workflows; 2 development-source image cases passed separately and gained production guards. Checks include no hover editing, disabled/reduced-motion controls, keyboard selection and settled idle RAF. Native frame latency/RAM unmeasured. | `icon-motion.spec.ts`; affected image/sidebar/editor case only |
| AnimateIcons integration, 1.3.5 | 12 development / 34 final production checks passed; build/native/NSIS passed. Finite animation, cancellation, selection, keyboard and 300 ms settled idle covered. Concurrent pen edits were outside the frozen installer snapshot. | `icon-motion.spec.ts` |
| Drawing/marker/assist, 1.3.4–1.3.6 | Marker production group 41 passed; Draw group 36; bottom fix 18 existing plus 2 targeted; sizes 22; tool grouping 24; assist 29. Groups overlap. Covers Undo/Redo, persistence/Reference/import, cancellation, mode reversal, exact endpoints and reduced synthetic jitter. Native database stored marker HTML; actual pen-device feel unmeasured. | `drawing-pen.spec.ts`, `highlighter-pen.spec.ts` |
| Selected-text colors, 1.3.3 | 8 development feature / 14 selected production checks passed. Includes 6 menu cases, independent resets, rich-text preservation, keyboard/Escape/focus, reload/Reference/import and themes. Older source-only image and folder helper failures were recorded separately. | `selection-colors.spec.ts`, affected `menu-exclusivity.spec.ts` case |
| Board context menu, 1.3.2 | 17 development / 21 selected production checks passed: Duplicate/Delete/Undo, canvas identity, key navigation, viewport fitting and reduced motion. | `board-context-menu.spec.ts` |
| Focus, 1.3.1 | 4 feature checks; broader 32 applicable development / 2 production-only skipped; 9 board-design; 17 selected production passed. Preserved editor/canvas selection, save retry, full-width layout and reversal. | `focus-mode.spec.ts` |
| Sidebar creation, 1.2.2 | 17 relevant development / 17 selected production passed; 2 cropped preview checks repeated. Keyboard creation, placement, panel resizing and narrow/scaled controls covered. | `sidebar-create.spec.ts` |
| Board resize/save/recovery, 1.2.1 | 73 unique applicable development checks across overlapping runs; 26 selected production passed. Snapshot isolation, live resize save, retry, recovery artifacts and unchanged image bytes covered; native database diagnostic passed. | `board-saving.spec.ts`, `recovery.spec.ts` |
| Attachments/startup/performance, 1.2.0 | 153 unique applicable development checks across initial run and isolated harness repairs; production 57 passed / 4 dev-only skipped; Rust 7 passed. Attachments/delta/startup diagnostics passed. HMR module duplication was a harness issue. Historical whole-notebook quota accounting was retired with the later storage change. | `performance-enhancements.spec.ts`, relevant recovery/image cases |
| Board design, 1.1.3 | Development 143 passed / 3 skipped plus 2 interrupted folder cases passed on rerun; production 53 passed / 4 dev-only skipped. Offline fonts, CSP, lazy engine, Reference and Mermaid/save behavior covered. | `board-design.spec.ts`, affected `boards.spec.ts` / `board-extensions.spec.ts` cases |
| Finalization, 1.1.2 | 136 development passed / 3 production-only skipped; 24 focused finalization/sidebar checks passed after final guard. Tests exercise recovery corruption, stale-save preservation, exports and image dependencies. | `finalization.spec.ts`, `recovery.spec.ts` |
| Early boards/import/images, 1.0.6–1.1.1 | Existing records document native/browser save/reload, image resizing/Undo/Reference, actual PDF/DOCX parsing, partial import failures, Mermaid topology/templates and safe portable drawings. File-import pass was 79 browser behaviors across runs. Board 1.1.1 recorded 123 regressions, 2 final hierarchy checks, 1 compact-window case, 16 production and 4 Rust checks passing. | `file-import.spec.ts`, `image-blocks.spec.ts`, `boards.spec.ts`, `board-extensions.spec.ts` |
| Code highlighting, 1.0.5 | 13 focused checks passed: detection/override, Unicode/safe tokens, ambiguous/large input, selection/typing/Undo. Browser layouts inspected; build passed. | `code-highlight.spec.ts` |
| Reference resize, Oct 4 | 21 selected production checks passed in installed Edge, including sidebar resize, menus and Focus. Two development board-navigation timeouts during build contention passed against production. Native divider performance unmeasured. | `reference-resize.spec.ts` |
| Core navigation/controls, 1.0.1–1.0.6 | Sidebar resize 16 checks; native HTML drag 12; naming/sidebar group 23; folder-copy era suite 41; deletion era suite 53 plus 8 targeted; exclusive-menu group 6. Counts overlap and do not supersede the later unresolved drag. PostgreSQL restart/Unicode/stale-save diagnostics passed for packaged builds. | `sidebar-drag.spec.ts`, `sidebar-resize.spec.ts`, `reference-resize.spec.ts`, `note-naming.spec.ts`, `folder-copy.spec.ts`, `archive-navigation.spec.ts`, `menu-exclusivity.spec.ts` |
| Early branding/theme/window | Browser layout/title/theme checks and screenshots recorded. Initial Notify branding native compilation failed with `0xffffffff`; later versioned builds passed. Obsolete Notify image generators and masters were retired after Scribly branding replaced them. | `app-icon.spec.ts`, `appearance.spec.ts`; current branding generator |
| UX follow-up, Oct 4 | Focused browser geometry, narrow Settings/board, logo picker insertion, scrolling and Reference actions observed without page errors; build passed. Earlier 31 writing/menu and 61 navigation groups belong to the preceding pass, not the follow-up. | `ux-critique.spec.ts`; select only affected behavior |
| Notepad import, Oct 4 | 30 selected browser checks and 11 native parser tests passed. Isolated WebView2 verified synthetic Notepad and real-parser Notepad++ imports, whitespace/reload/duplicates and trigger focus. Real Notepad recovery was scanned read-only; Notepad++ live backup production and the native folder picker were untested. Historical Clippy allowed an unrelated `manual_range_patterns` warning. | `notepad-import.spec.ts`; `test-native-notepad.ps1`, `test-native-notepad-ui.ps1` |

## Known limits and harness lessons

- **Open:** Unfiled round-trip native HTML drag hang in 1.3.17. The older 12-case drag pass does not resolve this newer failure.
- **Open roadmap:** CAP-01 storage usage reporting and CAP-03 sustained load/typing/save/RAM/frame profiling. See [enhancement plan](../docs/enhancement-plan.md). Isolated timings, byte sizes and short idle checks are not general performance guarantees.
- **Not established:** complete screen-reader/IME/high-DPI/maximized/device-pen behavior, physical full-disk/power-loss timing, and current clean-install/upgrade wizard behavior. Simulated write failures and isolated database restarts have their own narrower evidence.
- **Export limits:** native HTML Save was verified in 1.3.15; ZIP picker bytes were captured without saving through its dialog; actual native PDF saving remains unconfirmed. Full Unicode glyph coverage, large-image pagination and sustained export memory profiling remain unmeasured. Miro clipboard compatibility is not end-to-end verification in a user's Miro account.
- **Capture scope:** real foreground shortcut and conflict passed in 1.3.16, not repeated in 1.3.17. Do not merge the claims.
- **Harness corrections:** Vite HMR may create duplicate module registries; resolve imports from a live production-used module. Source imports cannot run against built assets. Wait for editor selection, settings acknowledgement, menu closure and stable geometry before assertions. Do not weaken behavior expectations to hide failures.
- **Packaging:** concurrent source/output changes must not be certified by an older hash manifest. An outer wrapper failure may follow a successful NSIS build; inspect the actual exit/output and artifact rather than reflexively rebuilding.
- **Historical dependency audit:** 1.3.9 recorded no npm vulnerabilities and no vulnerability-class RustSec advisories; informational `proc-macro-error` / `glib` warnings were outside the Windows normal/build graph. This is not a current dependency-security assessment.

## Historical UI audit: 1.3.12, Oct 4–5

Snapshot `0d3fa69d168402f8bb7740547003be1aff03fcc0`. The audit changed no application code. It recorded 44 findings and a provisional editorial score of 64/100, not a test success rate or current accessibility verdict. Many matrix cells were NOT VERIFIED. Audit-local corrected test copies adapted stale assumptions and were not independent application fixes. Native Windows, screen-reader and performance gaps remained.

The following findings are preserved for targeted follow-up. Their present status is **not revalidated**; inspect newer implementation before fixing or retesting. Historical details and observations are recoverable from Git as described below.

| ID | Severity | Historical finding |
| --- | --- | --- |
| F01 | Major | Select keyboard focus fails non-text contrast |
| F02 | Major | Board main-menu button has no accessible name |
| F03 | Major | Large size consumes the sidebar note list at the minimum window |
| F04 | Major | Sidebar reorder has no equivalent non-drag pointer action |
| F05 | Major | Panel resize lacks a non-drag pointer method for intermediate widths |
| F06 | Major | Image resize lacks an equivalent non-drag pointer width control |
| F07 | Major | Selected-text context menu removes native editing commands |
| F08 | Major | Modals lack explicit background-inert enforcement |
| F09 | Major | Replacing Settings with shortcuts drops focus to the body |
| F10 | Major | Structure edits have no Undo history |
| F11 | Major | Error toasts disappear before users can recover |
| F12 | Minor | Narrow Reference covers writing instead of resolving panel priority |
| F13 | Minor | Minimum-window chrome exceeds the writing budget |
| F14 | Minor | Search has no result-keyboard navigation or Escape-clear path |
| F15 | Minor | Sidebar and active-item options diverge |
| F16 | Minor | Note/board right-click menu anchors to ellipsis rather than pointer |
| F17 | Minor | Palette grid omits spatial Left/Right navigation |
| F18 | Minor | Palette toolbar trigger does not announce expanded state |
| F19 | Minor | Palette trigger re-click reopens instead of dismissing |
| F20 | Minor | Action popovers lack window-blur dismissal |
| F21 | Minor | Menus and dialogs unmount without an exit |
| F22 | Minor | Destructive confirmation initially focuses Close instead of Cancel |
| F23 | Minor | New/rename folder initially focuses Close instead of the field |
| F24 | Minor | Unsaved folder draft closes without a discard policy |
| F25 | Minor | Mermaid creation draft closes without preservation or discard confirmation |
| F26 | Minor | Folder-removal wording omits the folder name and affected count |
| F27 | Minor | Board deletion uses note terminology |
| F28 | Minor | Image caption Escape commits instead of cancels |
| F29 | Minor | Folder disclosure state resets across sessions |
| F30 | Minor | Drag hover does not expand a collapsed destination folder |
| F31 | Minor | Hover-revealed actions change title geometry |
| F32 | Minor | Native title tooltips do not implement the keyboard tooltip contract |
| F33 | Minor | Long select values truncate without a discoverable full label |
| F34 | Minor | Logo result changes have no live count announcement |
| F35 | Minor | Logo scroll position is lost on reopen |
| F36 | Minor | Board exports lack a busy state and duplicate-submit guard |
| F37 | Minor | Failure toast always displays a success check |
| F38 | Minor | Browser export says downloaded without completion evidence |
| F39 | Minor | Secondary helper text starts below the brief’s minimum |
| F40 | Minor | Note title has no equivalent heading landmark |
| F41 | Minor | Maximized window still announces Maximize |
| F42 | Minor | Icon family and routine decorative animation violate project consistency |
| F43 | Minor | Disabled tool actions omit explanatory reasons |
| F44 | Nit | Duplicate folder names have no inline distinction |

## Evidence provenance and cleanup

Consolidated from the previous `tests/verification.md`, feature review/handoff documents, `audit/` ledgers, and local release verification JSONs. Original tracked text and all 44 detailed audit observations remain recoverable with `git show 98f5285071b4b0442086f4f5937a8092a96c898a:<original-path>`; there is no need to keep duplicate files in the working tree.

The 133 root Playwright output folders contained 72 last-run statuses marked passed, 59 failed, and 2 without metadata. These are historical run statuses, not unique test totals or 59 unresolved product bugs; failed intermediate runs often preceded targeted corrections above. The latest unresolved drag evidence is retained separately. Disposable raw logs, snapshots, old build profiles, duplicate installers and resolved-run traces were moved out of the checkout after consolidation. Active test definitions, referenced fixtures, build/dependency tooling, licenses, current branding inputs, feature guides and the unfinished roadmap remain.

The generated artifacts and retired files are recoverable locally at `D:/Projects/work-essential-cleanup-archive-20261005/` (outside this repository). Automatic policy review blocked bulk permanent deletion, so cleanup used same-volume moves. This reduces checkout clutter without reclaiming disk space; the archive retains the old build junctions without traversing or deleting their live dependency targets.
