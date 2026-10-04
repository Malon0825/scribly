# Flowchart export review — 1.3.8

The main path is **Copy for Miro → paste onto a Miro board**. It copies plain Mermaid for the entire current board, including edits that have not yet autosaved. It does not open a dialog or load the Mermaid renderer when the diagram is complete. **Mermaid** opens a preview with **Copy code** and **Download Mermaid**. Both actions use exactly the same source; downloading creates a `.mmd` file.

Default to the whole board and left-to-right layout on a new board. Retain an existing board's direction and remember explicit changes. Direction is an optional control in the review dialog, rather than a choice required before every export. Export buttons stay visible in Focus, at the minimum window size and with large text. Drawing, SVG and PNG remain separate visible commands; Copy for Miro is the primary action.

Miro documents direct pasting of Mermaid onto a board and the alternative Creation bar → Diagram → Build with code. The receiving Miro account has not been exercised. Names, supported shapes and connections transfer; Miro arranges them. Logos, colors, exact coordinates and sketch styling remain drawing content. The success message and preview dialog explain this distinction. [Official Miro instructions](https://miro.com/mermaid-diagram/)

## A. Feel audit

Before: export was hidden behind Board actions in Focus; Mermaid required a dialog before copying; every warning blocked both copy and download. A first-time user saw four direction choices before reaching export. The dialog could place action buttons below its long, scrolling content. These are concrete interaction findings in `BoardEditor.tsx`, `.board-top-controls`, `.mermaid-dialog` and `boardToMermaid`.

Browser observations after implementation:

| Area | Score | Evidence and limits |
| --- | --- | --- |
| Response | 5 | Existing immediate `button:active` feedback retained; clipboard starts on normal click/Enter. No preview wait on quick copy. |
| Directness | 5 | Complete diagrams copy in one activation without a dialog or a direction choice. Export remains visible in Focus. |
| Interruptibility | 5 | Escape closes during clipboard work; an attempt token suppresses late UI feedback and allows reopening. Preview responses are ignored after dismissal. |
| Spring behavior | N/A | No custom gesture or spring introduced. Dialog geometry is instant. |
| Spatial consistency | 5 | Shared centered Dialog returns focus to the owning export action. Show shape selects/centers the issue and reveals repair tools, including in Focus. |
| Materials | 5 | Light/dark screenshots retain solid panel/chrome, semantic borders, system text and existing dim layer. |
| Reduced motion | 5 | Minimum-window tests with reduced motion retain readable controls and keyboard focus. Shared CSS removes entry transitions and icon movement. |

These scores describe the tested browser behavior, not a measured native frame-rate or RAM benchmark. Windows WebView2 interaction/performance: **[NEEDS INPUT]** until an installed-app run is available.

## B. Interaction redesign

1. Draw and label shapes; attach arrows to their intended shapes. Ordinary rectangles, diamonds and ellipses are components by default.
2. Click or press Enter on **Copy for Miro**. Copy the latest whole-board Mermaid immediately, then display honest clipboard success and a paste instruction.
3. Missing labels use the existing Untitled component fallback; nonstandard arrowheads become standard arrows. Explain these harmless changes after copying without an acknowledgement checkbox.
4. If a connection/component would be omitted or explicit boundary grouping cannot be preserved, open the review dialog instead. Copy/download stay disabled until the user repairs the drawing or acknowledges those specific limitations. Never infer a detached connector's endpoints from visual proximity.
5. **Show shape** closes immediately, selects the problem and exposes Architecture tools. Export again to recalculate diagnostics. Drawings remain authoritative and are not modified by conversion.
6. **Mermaid** offers preview, visible code, Copy code, Download Mermaid and optional direction. At narrow widths, show preview before code. Keep footer actions outside the scrolling preview/diagnostics region.
7. Clipboard failure opens/selects the code and offers Ctrl+C or download. Download errors appear inside the dialog, and a successful retry clears the error. An empty board provides a concrete drawing instruction. An oversized preview can still be copied/downloaded.

No gesture, rubber-band, snap target or momentum projection applies. Escape, Close and backdrop dismissal accept input during rendering/copying. Dismissal invalidates pending UI feedback. Board identity, Undo, editor selection, saving and read-only Reference retain their existing owners.

## C. Motion specification

Reuse shared Dialog: centered final geometry with no positional/scale animation; opacity 0 → 1 over 100ms via existing CSS, immediate unmount on dismissal, no bounce and no new keyframe. Runtime reduced motion removes the opacity transition. Press feedback stays immediate on pointer-down; commands still activate on click or keyboard. Existing AnimatedIcon motion remains finite and honors the shared live reduced-motion preference. Velocity handoff and physics parameters are N/A. No layout animation or blur animation added.

## D. Materials and hierarchy

The command strip uses solid `--chrome`; the primary copy action uses the existing accent. The dialog, preview and action footer use solid `--panel`; code uses `--chrome`, text uses `--text`/`--muted`, errors use `--danger`, and separators use `--line`. Retain the existing modal scrim, theme-aware dialog shadow and reduced-transparency fallback. No extra glass or added blur. Focus deliberately keeps a compact export strip while secondary authoring commands remain behind their existing toggle; the drawing retains the full workspace width.

## E. Implementation and validation

- No dependency added. Existing conversion, storage export, theme tokens, Dialog, AppSelect and icons reused.
- `ConversionIssue.requiresReview` distinguishes structural loss from harmless notices; conversion identities, labels, topology and omission diagnostics are preserved.
- Quick copy generates code on demand and defers the renderer. A busy flag prevents duplicate clipboard requests; cancellation/unmount tokens prevent stale feedback. Other panel and dismissal controls remain usable.
- Optional direction changes use the existing board draft/autosave path. Archived boards can export but cannot change persisted direction.
- Production browser checks cover clipboard success/failure/cancellation, preview/copy/file identity, latest bound-label edits and Undo, defaults/remembered direction, omissions and repair, empty/large previews, download failure/retry, Focus, light/dark themes, large text, narrow geometry and keyboard focus.
- Existing board, brand, saving/recovery and import/Reference regressions run alongside the new flow checks. The older save-failure test now injects a browser storage failure directly, so it exercises both production and development builds rather than intercepting only a development module URL.
- Final validation: 69 production checks passed; four development-only failure checks passed separately. These include a just-edited bound label in quick copy and the following Undo. Total production JS artifacts are 7,442,915 bytes, 2,304,870 bytes gzipped: a 493-byte gzip increase from the verified 1.3.7 build. Quick-copy tests confirm no `mermaid.core` request. These artifact/request measurements do not establish native RAM or frame timing.
- Final build/test/artifact evidence is recorded in `release/export-flow-verification-1.3.8.json`. Native installation and interactive RAM/frame timing have not been tested, and the installed notebook was not changed.

## F. Screen-specific do / don't

Do keep Copy for Miro visible, choose safe defaults, copy immediately when structure is intact, show precise loss diagnostics, keep manual/file fallback accessible, and preserve Undo and saving.

Don't gate harmless visual simplifications, pretend Mermaid transfers logos/coordinates, silently drop broken connections, remount the canvas for export, wait for preview rendering before copying, or hide dialog actions below long content.
