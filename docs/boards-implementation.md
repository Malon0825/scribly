# Boards in Notify 1.1.1

For the subsequent 1.1.3 theme, sizing, keyboard-focus and reduced-motion corrections, see the [AGENTS.md design review](boards-design-review.md). The export workflow below reflects 1.3.8; see the [current flowchart export review](board-export-review.md). Other release-specific observations describe the original implementation.

Implemented 3 October 2026. Boards live in folders alongside notes and open an embedded Excalidraw editor in the central panel. Use **New board**, **Ctrl+Shift+N**, or a folder's options menu. The folder plus button retains its existing New note behavior.

## Drawing and architecture workflow

The pinned MIT Excalidraw 0.18.1 engine supplies selection, pan/zoom, rectangles, diamonds, ellipses, bound arrows, lines, free drawing, text, images, erasing, frames, laser pointer, undo/redo and contextual shape/text/connector properties. Color, fill, stroke width/style, roughness, opacity, text fonts/sizes/alignment, layer order and connector arrowheads remain engine controls. At compact canvas widths the properties panel is behind **Edit**. No drawing engine was reimplemented.

For architecture export:

1. Label component shapes by double-clicking them. Bind connector ends to their intended shapes.
2. Select a server outline or frame, open **Architecture**, and assign **Boundary**. Give an outline a bound label or a frame a name.
3. Select each component and choose its **Architecture boundary** explicitly. Moving it visually does not silently change membership.
4. Mark decorative boxes or connections **Annotation**. Ordinary free text, freehand marks and images remain drawing content.
5. Click **Copy for Miro** to copy the entire board with its saved direction (left-to-right by default). Paste directly onto a Miro board, or use Creation bar → Diagram → Build with code. The receiving Miro account has not been tested. [Official Miro instructions](https://miro.com/mermaid-diagram/)
6. Choose **Mermaid** when you want a preview, optional direction change, **Copy code**, or **Download Mermaid**. **Show shape** selects a problem and reveals its repair tools. Only structural omissions or lost grouping require acknowledgement; missing labels and simplified arrowheads use defaults. Export actions remain visible in Focus.

Mermaid transfers supported topology and labels with automatic layout. It does not preserve exact positions, sketch styling, fonts or layer order. Rectangle/diamond/ellipse components, explicit nested subgraphs, directed/reversed/bidirectional/unheaded edges, labels and stable identifiers are supported. Detached connections and deleted endpoints are omitted with diagnostics. Boundary cycles, missing parents and unsupported semantics are diagnosed rather than silently inferred. Duplicating tagged groups remaps boundary membership; undo restores the previous scene.

**Drawing** exports a portable `.excalidraw` scene including image files and custom metadata. Folder **Import files** accepts that format. SVG/PNG export supplies a visual reference; `.mmd` download supplies plain Mermaid. JSON backups in Settings contain both notes and boards. The Reference panel supports read-only drawing previews as well as notes; Copy to current note stays note-only. Copy last note and Weekly update skip boards.

## Data and saving

The implementation retains the ordered `workspace.notes` collection. Each item is a TypeScript discriminated union: legacy/explicit note with HTML content, or `kind: "board"` with empty HTML and a versioned Excalidraw payload. This differs from the proposal to rename the collection to `items`: retaining the existing collection avoids rewriting sidebar order, backups and recovery records. `schemaVersion: 2` marks workspaces containing boards; existing notes do not require conversion. Older app versions should not be used to edit a mixed notebook.

The scene plus binary image files is authoritative. Mermaid and its preview are derived. Only background/grid and export direction are saved from app state; transient selection, pan, tool state and menus do not become notebook content.

Canvas changes stay in a live draft, checkpoint after 350 ms idle and at most 1,200 ms during continuous drawing, then use the existing serialized database save queue. Navigation, metadata operations, exports, backup, explicit save, blur and close checkpoint before reading workspace data. Dirty state clears only after the corresponding checkpoint is acknowledged; Saved appears only after persistence succeeds. Failures retain recovery records and expose Retry. The editor error boundary can export retained raw data, including the current live draft if the canvas fails.

Desktop data uses the existing revision-guarded PostgreSQL JSONB row. Browser preview uses local storage with its smaller browser quota. Atomic recovery manifests and immutable item records preserve mixed workspaces; no recovery key rename is needed. Import/restore reject unsupported future schema versions, executable embeds, unsafe links, invalid geometry, missing image files and malformed architecture tags. Limits are 2,500 active elements (bounded deleted history), local PNG/JPEG/WebP/GIF files up to 5 MB, and 20 MB for the whole notebook. Inserted images also use the existing 25-million-pixel decoder limit. Imported scene assets receive raster signature/type/size validation; the engine decodes them when opening.

## Offline assets and security

All drawing fonts are bundled in `public/excalidraw/fonts`, with `EXCALIDRAW_ASSET_PATH` configured before the lazy editor loads. The pinned editor unconditionally adds a CDN fallback to every FontFace. `scripts/patch-excalidraw.mjs`, run on npm postinstall, removes that fallback and embeds complete local font shards in SVG instead of invoking the glyph-subsetting runtime in both development and production builds and fails if the version or expected pattern changes. Fonts themselves are unchanged. Full library/font notices accompany the installer.

The desktop CSP permits same-origin font-byte fetching. SVG uses complete bundled font shards because the upstream subsetting runtime requires JavaScript unsafe-eval; the patch avoids that runtime. Same-origin scripts/workers remain enforced, with neither unsafe-eval nor external network sources enabled. SVG files may be larger than glyph-subset exports. Arbitrary embeds and hosted AI controls are disabled. Local Mermaid rendering uses strict security, plain labels and bounded graph size. Board and Mermaid modules load on demand, preserving the note startup path. The drawing chunks are large; Vite's chunk-size advisory is retained rather than hidden.

## Verification of the original 1.1.0 release

- Full regression suite: 113 checks passed, including 11 board checks. An additional disk-failure/retry check passed. Existing note, image, import, naming, archive, deletion, menu, recovery and sidebar checks passed.
- Rust unit checks: four passed, covering board validation and existing folder integrity.
- Native PostgreSQL diagnostic: boards, raster assets and architecture metadata survived restart alongside note HTML, Unicode, code, images and appearance settings. Stale revisions remained rejected. Final report: `release/database-test-boards-1.1.0.json`.
- Production build, Windows NSIS packaging and dependency audit are recorded in the release verification. The audit reported zero vulnerabilities.
- Browser screenshots cover light desktop and dark 850×600 with reduced motion. Canvas identity survives panel changes; properties, export dialogs and PNG output were checked. Production CSP/local-font SVG checks are recorded after the final security adjustment.
- 21st review of the touched board/editor/dialog files reported zero findings. Existing Dialog, AppSelect and ActionPopover were reused; catalog toolbar metadata informed the compact command strip without importing catalog code.

Native drawing gestures, clipboard and Windows save-dialog interaction remain unverified: automatic approval review rejected the isolated WebView2 UI diagnostic with “blocked by policy.” The database diagnostic runs without UI. The installed app and personal notebook were not upgraded or edited by these checks. Miro account interoperability, IME behavior and large-board WebView2 performance remain manual checks.

## A–F interaction review

**A. Feel audit.** Browser evidence only: response 4/5 (tool controls and inspector respond on click, existing immediate press treatment); directness 4/5 (engine drawing and native sidebar ownership retained); interruptibility 4/5 (panel changes retain the canvas and menus/dialogs dismiss immediately); spring behavior N/A (no new spring or custom gesture); spatial consistency 4/5 (canvas resizes within central panel, anchored app controls retained); materials 4/5 (solid themed shell and editor, existing modal scrim); reduced motion 4/5 (850×600 check, instant Mermaid dialog, engine CSS transitions disabled). Native feel and measured latency: [NEEDS INPUT]. Scores do not imply target-display frame measurements.

**B. Interaction.** New board opens in its chosen folder; draw/select with the engine's tools; manipulate contextual styles; assign roles/membership through keyboard-accessible app controls; review conversion; copy/download; dismiss and return to the command. App keyboard commands respect dialog ownership and handled events. Textarea participates in Dialog's focus trap. Hidden panels retain the app's existing focus semantics; the canvas remains mounted across layout changes. No synthetic overscroll or momentum is introduced.

**C. Motion.** No new physics controller, velocity projection or bounce. Engine owns canvas gestures; sidebar retains native drag. Mermaid dialog entry/exit is instant (`animation: none`), within the existing centered modal geometry. Reduced motion disables engine CSS animation/transitions. Existing app panel transitions remain their current owner; no second animation competes with them. Direct pointer tracking is not decorated with a settling animation.

**D. Materials.** Commands/inspector use `--chrome`, `--panel`, `--line`, `--fg`, `--muted`, `--accent` and `--active`. Document/canvas are solid. Mermaid uses the existing solid Dialog and scrim; no new glass layers, sounds, blur animation or palette. Excalidraw theme follows Notify while authored drawing colors/fonts remain scene data.

**E. Implementation checks.** Discriminated payload, backup/recovery, Rust validation, scoped shortcuts, file ownership, lazy engine, local fonts, editor error recovery, truthful save status, clipboard fallback, explicit partial export, history and boundary duplication are implemented. Note editing regressions and light/dark compact layouts passed. Native pointer/clipboard and Miro paste: [NEEDS INPUT].

**F. Do/don't.** Use bound labels/arrows and explicit boundaries; retain exact drawing format for editing; review conversion warnings; retry failed saves; use SVG/PNG for visual interchange. Do not infer server membership from visual proximity, promise Mermaid layout fidelity, bounce canvas content, route board operations through Tiptap, or tie saving to animation completion.

## Deliberate scope limits

The stable release does not supply screenshot parity for draw-to-shape, bucket fill or lasso. Hosted AI text-to-diagram, wireframe-to-code, arbitrary web embeds, collaboration and direct Miro synchronization are outside this release. Mermaid import into a new board, packaged architecture templates, nested boundaries and board Reference previews ship in 1.1.1. A larger asset store remains a separate extension. See [the feature audit](boards-feature-audit.md) for implemented gaps and remaining scope. These limits were present in the approved stable-first plan.

## Added in 1.1.1

Use **Import Mermaid** to paste a flowchart or choose a .mmd/.mermaid file, preview the editable drawing, then create a separate board in the current folder. **Templates** supplies four architecture starting points with editable source and titles. Folder Import files also accepts Mermaid files. Explicit parent boundary selection supports nesting and filters cyclic assignments. In Reference, select a board or choose Show as reference from its sidebar actions; Fit/zoom and keyboard scrolling affect the static preview only. Detailed conversion limits and evidence: [feature audit](boards-feature-audit.md).

Validation of 1.1.1: 123 regression checks, two final hierarchy checks, a focused compact-window check, 16 production checks and four Rust checks passed. Desktop nested metadata and board Reference restart diagnostics are recorded with the installer in [tests/verification.md](../tests/verification.md) and release/boards-verification-1.1.1.json. Native UI/clipboard, IME, large-board performance and actual Miro paste remain unverified.
