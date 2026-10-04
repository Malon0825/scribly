# Notebook usability improvements

The two supplied Scribly critiques guided refinements of the existing Windows notebook. The three-panel hierarchy, system typography for controls, editor instance, autosave and native sidebar dragging remain the foundation. This record describes the follow-up implementation by source review; it does not treat earlier browser checks as verification of the current changes.

## A. Feel audit

Current feel scores remain **[NEEDS INPUT]**: the focused browser checks below establish specific geometry and actions, not a complete interaction audit. Earlier verification reported Response 4/5, Directness 4/5, Interruptibility 3/5, Spatial consistency 4/5, Materials 4/5 and Reduced motion 4/5. Those scores belong to the previous pass only. Spring behavior and custom gesture boundaries remain N/A for this usability work.

Current source evidence: `src/styles.css` aligns `.document-head`, `.editor-toolbar` and `.note-editor-surface` to one 70ch measure and makes the toolbar sticky. `NoteEditor.tsx` and `HighlighterTools.tsx` identify commands, heading level and mode/options ownership. `App.tsx` retains immediate click semantics, Reference focus preservation and panel state; `BoardEditor.tsx` portals board commands into the topbar. Existing panel grid transitions and overlay entry behavior remain, with no new spring controller or velocity-preserving reversal claim.

Windows/WebView2 rendering, target-display smoothness, maximized geometry and native update/export behavior remain **[NEEDS INPUT]**. Previous Rust compilation was blocked by missing MSVC `link.exe`; that is historical evidence, not a current native check.

## B. Interaction redesign

Writing uses one reading column: the title scrolls away; the toolbar and its divider stay visible, while the single-row toolbar stays at the top of the document scroll area. Tooltips identify controls and available shortcuts; Heading 1 is explicit, and drawing/highlighting expose their active mode separately from options. Native text selection, document scrolling and Tiptap remain the interaction owners.

Board mode groups commands in the topbar as Insert, Architecture and Export, removes the document footer and keeps compact save status/retry in the topbar. Insert contains logos, templates, Mermaid import and Shape library. Export contains drawing, SVG, PNG, Mermaid and the secondary Copy for Miro action. Architecture exposes roles, boundaries and object snapping; new tools use clean strokes and elbow arrows. Existing scene styles remain unchanged. Focus stays available and alignment uses Excalidraw's multi-selection controls.

The logo picker opens on Popular with the first matching brand previewed. Popular/Recent/All brands and category chips filter a virtual scrolling grid. Variants sharing a normalized brand title are grouped, and neutral preview backing helps white marks remain visible. Pointer selection or arrow-key browsing chooses a brand; Add to selection or Space/Enter queues it, and Insert components inserts the queue. Completed inserts remain saved if a later insert fails; the picker stays open and reports progress/errors. Closing aborts further insertion and restores trigger focus. This is batch insertion, not a docked or drag-driven picker.

Settings uses Appearance, Startup, Backup & restore and About tabs with keyboard navigation and a persistent Done footer. Appearance has one text-size slider plus independent app-element presets. About holds shortcuts, updates and expandable storage details. The note footer's Back up notebook exports directly, with amber emphasis when no export exists or the last export is at least seven days old; Export note names its scope.

Reference's empty state offers up to six recently modified, non-archived notes and boards. Selecting one preserves the writing focus path; the topbar Reference button exposes pressed state. Unfiled notes and Archive remain discoverable when empty. The usability pass itself introduced no Trash workflow. Integration with the restored main changes retains the existing Trash, restore and recovery workflows; permanent deletion still requires confirmation and cannot be recovered from Trash. Earlier verification below describes the usability pass before that integration, not validation of the combined application.

## C. Motion specification

No new spring, inertia, release velocity or custom gesture animation was introduced. The existing workspace grid transition remains the sole panel layout owner. Existing menu/dialog transform and opacity behavior remains; this pass does not claim live-value spring reversal. Button press feedback retains immediate highlight and optional 1px translation, with highlight only under reduced motion. Menus reuse `ActionPopover` placement, Escape/outside dismissal, keyboard navigation and focus restoration. Native scrolling remains native, including the virtual logo grid. A motion-specific pass would need the controller and webview profiling required by AGENTS.md.

## D. Materials and hierarchy

Document and Reference content stay solid. Menus and dialogs reuse theme tokens, borders, restrained shadows, scrim and existing reduced-transparency fallbacks. The toolbar uses the solid panel token so moving text remains readable beneath it. Logo preview backing does not alter the inserted mark. Amber backup emphasis is semantic rather than decorative; browser history still records a download request, not confirmed disk retention. No new glass, backdrop animation or sound was added. Current light/dark contrast and narrow-window hierarchy require browser review.

## E. Implementation and validation

- Source review covered `App.tsx`, `NoteEditor.tsx`, `HighlighterTools.tsx`, `BoardEditor.tsx`, `BrandLogoPicker.tsx`, `SettingsContent.tsx`, `AppearanceSettings.tsx` and relevant styles. Existing state, editor, theme preferences, breakpoints and permanent-delete confirmations are retained.
- Sidebar controls name Sort and density, match neighboring control sizing and omit headings from normal body previews. Search matching retains contextual snippets.
- Current TypeScript/Vite production build passed. Focused browser review at 1440px measured identical title/toolbar/body left edges (527.39px) and widths (679.22px). At 850×700, Settings Backup and Done were reachable, and board mode had no footer with a 557×548.5 canvas. The logo picker mounted 25 tiles, previewed AWS automatically and inserted two queued components; no page errors occurred. A scroll check confirmed the title moved above the viewport while the sticky toolbar remained visible. Reference showed its pressed state and opened a recent item; the font preview was reachable by scrolling Settings. No new regression suite ran. Light and warm dark screenshots were inspected, with reduced motion used during the final layout review. Broader tooltip, editor selection retention, rapid reversal, menu ownership, Settings keyboard, backup error/cancel, virtual-scroll/white-variant, and System-theme coverage remain unverified for this follow-up.
- Historical verification: the preceding pass recorded a passing TypeScript/Vite build, 31 writing/drawing/focus/menu checks and 61 navigation/contrast/backup/resize/naming/folder checks, plus a focused memory fixture. Rust formatting passed; native compilation and device behavior were unverified. These results do not verify the follow-up changes.
- The documentation-only edits ran no additional tests or build. Native behaviors remain unverified until a Windows/WebView2 review.

## F. Screen-specific do / don't

Do preserve the live editor and truthful save/backup feedback, keep Reference and empty navigation discoverable, group board commands, show selected formatting/mode state, and retain keyboard alternatives. Do not tie persistence to animation completion, capture document pointers for panel movement, synthesize scrolling, introduce bounce/glass/sound, interpret browser downloads as confirmed backups, or imply Trash recovery after permanent deletion.


