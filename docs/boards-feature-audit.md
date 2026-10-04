# Architecture board feature audit — Notify 1.1.1

Compared the implemented 1.1.0 board adapter, original board plan, supplied tool screenshots and installed engine with the local architecture workflow. The core folder, drawing, saving, recovery and Mermaid export paths were already implemented.

| Gap found | Delivered behavior | Evidence |
| --- | --- | --- |
| Mermaid could be exported but not imported | Import Mermaid opens a source/file dialog; preview converts to editable shapes and bound connectors; Create board adds a separate board in the current folder | Nested/parallel-edge import, reload and export checks |
| No architecture starting points | Four editable templates: web application, event processing, database replication and nested deployment; preview and customize their source/title before creation | Every template creates a separate board with valid topology |
| Reference excluded boards | Notes and boards share the Reference picker and Show as reference action; boards use a static read-only drawing with Fit/zoom and keyboard scrolling | Note editing, preview zoom, reference selection and reload |
| Export flattened nested boundaries | Explicit parent boundaries produce nested Mermaid subgraphs; inspector filters cyclic/self assignments; missing parents and imported cycles produce repair diagnostics | Nested import/export, cycle and missing-parent checks |
| Portable drawings dropped export direction | Notify metadata in .excalidraw preserves LR/TB/RL/BT | Direction round-trip check |
| Converter silently rasterized subgraphs with Mermaid 11.17 | Guarded postinstall patch recognizes render-prefixed cluster IDs; image fallback is rejected; parallel arrows receive distinct IDs | Editable template/parallel-edge checks and strict production CSP check |

Mermaid parsing and rendering share a serialized local runtime because configuration and temporary DOM are global. Source changes invalidate the prepared preview; late conversions cannot create a stale board. Closing the dialog does not replace the active canvas. Failed syntax, unsupported diagrams, unsafe directives/HTML/links/assets and incomplete conversions leave documents unchanged. Import is bounded to 50,000 source characters, 300 components, 100 boundaries and 500 connections. Folder imports accept .mmd and .mermaid as boards.

Architecture membership comes from Mermaid's parsed graph or explicit inspector choices, never geometric containment. The pinned parsed-database API is necessary to preserve subgraphs; upgrading Mermaid requires rerunning the semantic fixtures. Imported diagrams use automatic layout. Exact freeform styles/coordinates are retained by the drawing format, not guaranteed by code conversion. Custom templates can be kept as boards in a folder and duplicated; no separate template store or asset migration is introduced.

## Remaining scope and release limits

- The stable Excalidraw 0.18.1 package still lacks draw-to-shape, bucket fill and lasso from the screenshots. npm's stable version was checked during this audit. Shipping these upstream controls requires a verified engine upgrade or a maintained engine fork; this update retains the pinned engine and guarded local-font patch.
- Hosted AI text-to-diagram, wireframe-to-code, web embeds, cloud collaboration and direct Miro synchronization remain separate capabilities. No account, credential, remote service or external publishing was added.
- Large-asset storage remains the current 20 MiB notebook model with bounded raster images. Browser quota errors remain recoverable. No storage limit was raised.
- Native drawing/clipboard/save-dialog interaction, IME composition, large-board WebView2 responsiveness and actual paste in the user's Miro workspace remain manual verification. Browser checks do not establish these results.

Sources: [converter API](https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api), [upstream converter](https://github.com/excalidraw/mermaid-to-excalidraw), [engine releases](https://github.com/excalidraw/excalidraw/releases), [Mermaid flowchart syntax](https://mermaid.js.org/syntax/flowchart.html). The source code of the installed versions was inspected before integrating their APIs.

## Interaction decisions and validation

The existing Dialog, AppSelect, themed commands and folder operations are reused. 21st code-editor metadata was inspected; no catalog component was copied because the existing dialog and plain code textarea fit Notify. Import and template dialogs retain the instant Mermaid dialog entry, focus trap, Escape/backdrop dismissal and focus return. New controls use immediate existing press feedback; there is no new spring, transform animation, synthetic scrolling or gesture controller. The drawing preview is solid and uses native scrolling. Zoom changes the preview's width rather than scaling the live editor. Reduced motion follows the same instant path.

The 1.1.0 A–F review still applies to the canvas and shell. B/E now include source-preview-create, nested parent selection and read-only board Reference. D uses the same solid panel/chrome/line tokens and existing modal scrim. Browser validation covers conversion, cancellation, independent creation, persistence and note editing beside Reference. Native feel scores remain [NEEDS INPUT]. Final test, packaging and diagnostic results are recorded in tests/verification.md and the 1.1.1 release report.
