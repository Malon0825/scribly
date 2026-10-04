# Note drawing assistance

Implemented October 3, 2026. Scope: the Draw tool over Tiptap note content. Architecture boards retain their existing Excalidraw engine.

## Library decision

Reviewed [tldraw](https://tldraw.dev/) and its [production licensing](https://tldraw.dev/community/license). It is a full infinite-canvas SDK and production requires an active trial, commercial or discretionary hobby license key. Embedding it here would introduce a second canvas editor with separate shapes, history and persistence alongside Tiptap. That is a larger product change than smoothing the current pen.

Use [perfect-freehand](https://github.com/steveruizok/perfect-freehand) 1.2.0, MIT licensed, already installed through Excalidraw and now pinned as a direct dependency. Do not claim the current tldraw SDK uses this package: its current source includes its own freehand implementation. The library's `getStrokePoints` streamlines samples; a small quadratic SVG centerline adapter preserves the existing constant pen width, colors and rounded caps. Its complete MIT notice is appended to the existing packaged `public/board-licenses.txt`.

## Behavior and parameters

- Auto assist starts on and appears as an ordinary keyboard-operable toggle in Drawing options. It applies only to new Draw strokes in Free mode. Switching tools preserves the session choice; reopening the editor starts with assistance on. Guided remains a straight line, and markers retain their existing behavior.
- Use `getStrokePoints` with `streamline: 0.4`, `size: 1` (a minimal sample threshold independent of selected pen width), and `last: true`. Render midpoint quadratic segments with the exact first and last points. The endpoint stays at the pointer; preview and saved strokes use the same renderer without a release-only correction.
- Keep moderate filtering and constant width. No shape recognition, network/AI processing, snapping, simulated pressure, spring or post-release animation. Smoothing rounds intentional corners too; turn it off when those matter.
- Persist original bounded, block-relative pointer samples plus optional boolean `smooth` on assisted drawing strokes. Validate it during import. Legacy strokes omit it and remain raw; toggling assistance does not rewrite existing marks. Keep parameters stable so saved drawings preserve their appearance.
- Existing pointer capture, cancellation, wheel mode reversal, RAF preview, Undo boundary, autosave, image anchoring and read-only Reference remain the owners of their behavior. A guided-to-free wheel reversal uses the retained freehand samples with the current assistance choice.
- Redraw after committed settings changes as well as pointer moves. This prevents a stale preview when the wheel changes mode before React commits its state and the user holds the pointer still. Keep the redraw ref cleaned up on unmount.
- Preserve solid themed options, existing checks, viewport clamping, focus return and document priority. No new material or animation; reduced motion uses the same direct pointer rendering.

## Validation

Production build and pen behavioral checks are recorded in `tests/verification.md`. Checks cover measured jitter reduction with exact endpoints, enabled preview/save/reload/Reference, keyboard opt-out, legacy and assisted imports, invalid values, width preservation, cancellation, both themes, reduced motion, narrow menu geometry and drawing in empty space near the bottom. Browser verification uses Chromium; native Windows WebView2 and a new installer have not been validated for this change.
