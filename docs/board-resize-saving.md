# Board resizing and saving

Board pointer interactions previously triggered a forced checkpoint every 1.2 seconds, including pauses while holding a resize handle. Each checkpoint stringify/parsed the complete scene and copied embedded image data. Workspace periodic saving could also checkpoint during the gesture. The synchronous recovery journal then stored a second complete image-bearing note before reclaiming the old record, creating both interaction stalls and avoidable quota failures.

`BoardEditor.tsx` now observes pointer lifetimes without capturing or intercepting the engine's gesture. Its 350 ms idle checkpoint waits until all observed pointers are released or canceled. Workspace automatic saves pass `force = false` and skip active board interactions, including the five-second safety interval. Explicit Save, note navigation, backup/export, window blur and close protection still force a checkpoint. Direct geometry updates remain owned by Excalidraw; no animation or position interpolation was added.

Snapshots detach element geometry with `structuredClone` and shallow-copy file metadata, sharing immutable image strings. A snapshot is reused until the live scene changes. Repeated reads of the same snapshot do not produce another workspace mutation, timestamp, recovery write or autosave. Save feedback continues to indicate pending work until storage acknowledges the final scene; save failures retain the live draft.

Recovery stores board image strings in separate immutable records and references them from small board records. Resizing or changing styles rewrites geometry and metadata while reusing unchanged images. Restore reconstructs the same self-contained board format, so drawing exports, portable backups and Undo retain their existing behavior. Existing inline recovery notes remain readable. Manifest commit stays atomic; failed writes retain the previous recoverable snapshot. Conflict records pin their image dependencies across restart and reclamation.

If migration exceeds storage quota, a dirty draft is retained. Only after the exact current snapshot is acknowledged by storage may the journal replace the current cache with a small clean manifest and reclaim unpinned records before retrying. Preserved conflicts are never discarded to make room. A genuine full or unavailable store still produces a warning. Retry now refreshes recovery even when the workspace already equals its acknowledged snapshot.

Design guidance: pointer geometry stays direct, input remains available, no editor/canvas remount is required for saving, and no motion dependency or additional animation owner was introduced. Theme tokens, keyboard commands, selection and read-only Reference remain intact. Reduced motion retains the same direct tracking. This is a persistence/interaction performance fix; existing panel motion and materials are unchanged.


See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
