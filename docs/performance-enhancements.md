# Notify 1.2.0: images, saving and startup interaction

The first performance priority is removing note image bytes from the desktop notebook's HTML and autosave messages. Implemented app-owned attachments, revision-checked incremental save messages and cached capacity calculations. Browser preview keeps its existing embedded images and storage behavior. Excalidraw scenes remain self-contained for engine compatibility and portable drawing exports; unchanged scenes are omitted from subsequent desktop save messages.

## Storage and failure behavior

- Native note images upload once as bounded binary bytes. Rust validates raster signatures, hashes content with SHA-256, deduplicates files, flushes a temporary file and renames it before returning its stable ID. IDs contain no user paths. Metadata contains IDs and sizes, not an image-byte cache.
- HTML serializes `data-notify-attachment` IDs without filesystem URLs. Only live editable and Reference image nodes resolve those IDs with `convertFileSrc`. Asset access starts with an empty scope and grants the current notebook's owned attachment directory, without recursion. CSP permits the asset origin only for images. This follows [Tauri's asset URL requirements](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc) and [binary request support](https://v2.tauri.app/develop/calling-rust/#accessing-raw-request).
- Desktop startup migrates eligible existing images after recovery selection. It adopts the migrated document only after successful file writes and validation; the database and original HTML remain intact until the revision-checked save succeeds. A failed migration exposes the notebook-opening error and Retry. Partially written, unreferenced files remain safe candidates for later cleanup.
- Workspace schema 3 prevents older versions from silently dropping references. New board creation/checkpoints preserve that version. Portable backup export reads and validates files, restores embedded raster data, and writes schema 2. Raw backups with unresolved local image references are rejected. The same 20 MiB capacity limit covers both stored metadata and the portable embedded-image equivalent, counting repeated image occurrences. Existing image/pixel/import/text limits remain.
- Image nodes preserve captions, percentage sizing, alignment, ordering, selection, read-only Reference, copying and Undo. Decoding is asynchronous. Native image downloads read/export within Rust; file bytes need not return to JavaScript. Missing/damaged file exports fail visibly.
- Cleanup runs at startup after recovery inspection, retains current database, selected workspace, archived-note and all recovery/conflict references, and removes only unused owned image files older than 30 days. It preserves active-session Undo. Storage/validation failures skip cleanup. Symbolic links and path traversal are rejected. There is no recursive deletion.
- Delta messages carry metadata, order and changed items. The frontend advances its baseline only after acknowledgement. Rust reconstructs and validates the candidate under the database mutex and retains the SQL revision guard. Failure leaves the draft and last acknowledged baseline intact. PostgreSQL still stores the complete notebook; this is an IPC optimization, not paginated database loading.
- Capacity checks cache each immutable item's serialized byte count in a WeakMap. Editing a note does not stringify an unchanged image-rich board again. Existing incremental recovery and bounded highlighting caches remain.

No additional `Arc` is introduced: [Tauri's managed state already shares ownership](https://v2.tauri.app/develop/state-management/#do-you-need-arc). Listener cleanup was inspected and exercised where touched; idle RAM alone is not treated as evidence of a leak. Loading only active/Reference bodies and a separate paginated large-log viewer remain future work. The current import limits have not been expanded to 50 MB.

## A. Feel audit

Scores describe browser checks, not native frame-time measurements.

| Principle | Score | Evidence |
| --- | --- | --- |
| Response | 4/5 | Normal pointer/keyboard activation; existing immediate press highlight; distinct checking/updating labels. |
| Directness | 4/5 | The switch thumb stays inside its track at scaled sizes. The drawing engine owns canvas manipulation; image resize remains immediate pointer tracking with one commit on release. |
| Interruptibility | 4/5 | Startup thumb retargets from live position/velocity; input is blocked only while actual registration I/O is pending. Rapid reversal and keyboard activation are checked. |
| Spring behavior | 4/5 | Analytic overdamped spring; no overshoot beyond track boundaries, no duration-based transform transition. |
| Spatial consistency | 4/5 | Off/on stay at their measured track edges. Existing left Sidebar/right Reference paths and canvas identity are retained. |
| Materials | 4/5 | Existing solid panel/line/accent tokens and control geometry; no new glass, backdrop or canvas effects. |
| Reduced motion | 4/5 | Runtime preference changes cancel the RAF and commit the final position immediately; highlight remains. |

Native Windows pointer feel, display-dependent drawing frame rates, and real sign-in behavior: **[NEEDS INPUT]**. Existing browser board design checks are documented in [verification history](../tests/verification.md).

## B. Interaction behavior

Startup reads the actual Windows registration on mount and window focus. An unknown initial state disables changes and offers Retry on failure. Pointer-down highlights without changing registration; click/Space requests the new state. While writing, focus refresh cannot overwrite the pending result. Only confirmed results update `aria-checked`; failures retain the previous confirmed state and expose an alert. Older read results and results after unmount are ignored. A subsequent command can reverse the thumb before its animation finishes. Focus stays on the switch. Under reduced motion, the confirmed thumb position changes instantly. Drag recognition, velocity handoff from a gesture, momentum and rubber-banding are N/A for this switch.

## C. Motion specification

`useSwitchSpring.ts` owns only thumb translation. Track travel is measured from actual content width, padding and thumb width when its geometry changes. Start/end are left/right content edges. Mass 1, stiffness 500, damping 45; velocities are CSS px/s. Exact exponential integration uses roots -20 and -25, retains live velocity on reversal, clamps physical track bounds, and stops its RAF at rest. No bounce, keyframe or competing CSS transform transition. A ResizeObserver measures changes outside the per-frame path. Runtime reduced-motion changes snap to the end and stop the animation. Cleanup cancels RAF and observers/listeners. Canvas dragging, shape resizing and image resizing receive no decorative position interpolation. The existing shell grid transition remains its sole layout-motion owner; no second controller is added.

## D. Materials and hierarchy

The notebook, Reference and startup row remain solid reading/control surfaces. Track uses `--line` and `--accent`; thumb uses `--panel` and its existing small shadow. Element scaling changes dimensions rather than document transforms. Busy/error feedback stays local and readable. No added translucency needs a new fallback; existing reduced-transparency support remains.

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.

## F. Do / don't

Do keep file writes before document references, retain drafts until acknowledged saving, preserve portable backups and let the engine own direct drawing. Keep drawing/UI colors and offline tools intact.

Do not claim that file-backed images eliminate decoding RAM, that a small seed-notebook idle sample establishes large-notebook memory savings, or that smaller IPC messages mean PostgreSQL is streaming the document. Do not animate drawing positions behind the pointer, keep RAF loops running at rest, remove files needed by Undo/recovery, or increase import limits without a bounded viewer design.
