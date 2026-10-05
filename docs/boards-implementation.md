# Boards in Notify 1.1.1

This guide describes the board workflow and integration boundaries. Historical validation and remaining runtime limits are consolidated in [verification history](../tests/verification.md).

Implemented 3 October 2026. Boards live in folders alongside notes and open an embedded Excalidraw editor in the central panel. Use **New board**, **Ctrl+Shift+N**, or a folder's options menu. The folder plus button retains its existing New note behavior.

## Drawing and architecture workflow

The pinned MIT Excalidraw 0.18.1 engine supplies selection, pan/zoom, rectangles, diamonds, ellipses, bound arrows, lines, free drawing, text, images, erasing, frames, laser pointer, undo/redo and contextual shape/text/connector properties. Color, fill, stroke width/style, roughness, opacity, text fonts/sizes/alignment, layer order and connector arrowheads remain engine controls. At compact canvas widths the properties panel is behind **Edit**. No drawing engine was reimplemented.

For architecture export:

Board commands share the app topbar: Insert groups Brand logos, Templates, Import Mermaid and Shape library; Architecture opens roles, boundaries and snapping; Export groups all formats and Copy for Miro. The document footer is absent in board mode, with compact save status/retry retained in the topbar. Focus remains available. New tools default to clean strokes, elbow arrows and object snapping; saved shapes keep their original styles. Multi-selection uses the engine's alignment controls.

1. Label component shapes by double-clicking them. Bind connector ends to their intended shapes.
2. Select a server outline or frame, open **Architecture**, and assign **Boundary**. Give an outline a bound label or a frame a name.
3. Select each component and choose its **Architecture boundary** explicitly. Moving it visually does not silently change membership.
4. Mark decorative boxes or connections **Annotation**. Ordinary free text, freehand marks and images remain drawing content.
5. Choose **Export → Copy for Miro** to copy the entire board with its saved direction (left-to-right by default). Paste directly onto a Miro board, or use Creation bar → Diagram → Build with code. The receiving Miro account has not been tested. [Official Miro instructions](https://miro.com/mermaid-diagram/)
6. Choose **Export → Mermaid** when you want a preview, optional direction change, **Copy code**, or **Download Mermaid**. **Show shape** selects a problem and reveals its repair tools. Only structural omissions or lost grouping require acknowledgement; missing labels and simplified arrowheads use defaults. Export remains available in Focus.

Mermaid transfers supported topology and labels with automatic layout. It does not preserve exact positions, sketch styling, fonts or layer order. Rectangle/diamond/ellipse components, explicit nested subgraphs, directed/reversed/bidirectional/unheaded edges, labels and stable identifiers are supported. Detached connections and deleted endpoints are omitted with diagnostics. Boundary cycles, missing parents and unsupported semantics are diagnosed rather than silently inferred. Duplicating tagged groups remaps boundary membership; undo restores the previous scene.

**Export → Drawing** exports a portable `.excalidraw` scene including image files and custom metadata. Folder **Import files** accepts that format. Export's SVG/PNG items supply a visual reference; `.mmd` download supplies plain Mermaid. JSON backups in Settings → Backup & restore contain both notes and boards. The Reference panel supports read-only drawing previews as well as notes; Copy to current note stays note-only. Copy last note and Weekly update skip boards.

Current follow-up validation: TypeScript/Vite build passed. Focused browser review at 850×700 confirmed no board footer and a 557×548.5 canvas; the logo picker previewed AWS with 25 tiles mounted and inserted two queued components. No page errors were observed and no new regression suite ran. Native gestures/clipboard/save dialogs, IME, Miro paste and large-board WebView2 performance remain unverified.

## Data and saving

The implementation retains the ordered `workspace.notes` collection. Each item is a TypeScript discriminated union: legacy/explicit note with HTML content, or `kind: "board"` with empty HTML and a versioned Excalidraw payload. This differs from the proposal to rename the collection to `items`: retaining the existing collection avoids rewriting sidebar order, backups and recovery records. `schemaVersion: 2` marks workspaces containing boards; existing notes do not require conversion. Older app versions should not be used to edit a mixed notebook.

The scene plus binary image files is authoritative. Mermaid and its preview are derived. Only background/grid and export direction are saved from app state; transient selection, pan, tool state and menus do not become notebook content.

Canvas changes stay in a live draft, checkpoint after 350 ms idle and at most 1,200 ms during continuous drawing, then use the existing serialized database save queue. Navigation, metadata operations, exports, backup, explicit save, blur and close checkpoint before reading workspace data. Dirty state clears only after the corresponding checkpoint is acknowledged; Saved appears only after persistence succeeds. Failures retain recovery records and expose Retry. The editor error boundary can export retained raw data, including the current live draft if the canvas fails.

Desktop data uses the existing revision-guarded PostgreSQL JSONB row. Browser preview uses local storage with its smaller browser quota. Atomic recovery manifests and immutable item records preserve mixed workspaces; no recovery key rename is needed. Import/restore reject unsupported future schema versions, executable embeds, unsafe links, invalid geometry, missing image files and malformed architecture tags. Limits are 2,500 active elements (bounded deleted history), local PNG/JPEG/WebP/GIF files up to 5 MB, and 20 MB for the whole notebook. Inserted images also use the existing 25-million-pixel decoder limit. Imported scene assets receive raster signature/type/size validation; the engine decodes them when opening.

## Offline assets and security

All drawing fonts are bundled in `public/excalidraw/fonts`, with `EXCALIDRAW_ASSET_PATH` configured before the lazy editor loads. The pinned editor unconditionally adds a CDN fallback to every FontFace. `scripts/patch-excalidraw.mjs`, run on npm postinstall, removes that fallback and embeds complete local font shards in SVG instead of invoking the glyph-subsetting runtime in both development and production builds and fails if the version or expected pattern changes. Fonts themselves are unchanged. Full library/font notices accompany the installer.

The desktop CSP permits same-origin font-byte fetching. SVG uses complete bundled font shards because the upstream subsetting runtime requires JavaScript unsafe-eval; the patch avoids that runtime. Same-origin scripts/workers remain enforced, with neither unsafe-eval nor external network sources enabled. SVG files may be larger than glyph-subset exports. Arbitrary embeds and hosted AI controls are disabled. Local Mermaid rendering uses strict security, plain labels and bounded graph size. Board and Mermaid modules load on demand, preserving the note startup path. The drawing chunks are large; Vite's chunk-size advisory is retained rather than hidden.

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.

## Deliberate scope limits

The stable release does not supply screenshot parity for draw-to-shape, bucket fill or lasso. Hosted AI text-to-diagram, wireframe-to-code, arbitrary web embeds, collaboration and direct Miro synchronization are outside this release. Mermaid import into a new board, packaged architecture templates, nested boundaries and board Reference previews ship in 1.1.1. A larger asset store remains a separate extension. See [verification history](../tests/verification.md) for implemented gaps and remaining scope. These limits were present in the approved stable-first plan.

## Added in 1.1.1

Use **Insert → Import Mermaid** to paste a flowchart or choose a .mmd/.mermaid file, preview the editable drawing, then create a separate board in the current folder. **Insert → Templates** supplies four architecture starting points with editable source and titles. Folder Import files also accepts Mermaid files. Explicit parent boundary selection supports nesting and filters cyclic assignments. In Reference, select a board or choose Show as reference from its sidebar actions; Fit/zoom and keyboard scrolling affect the static preview only. Detailed conversion limits and historical evidence: [verification history](../tests/verification.md).
