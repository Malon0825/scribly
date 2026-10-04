# Full-width Focus mode — Scribly 1.3.1

Implemented for notes and architecture boards. Focus uses the whole responsive central workspace, retains the active editor/canvas, and keeps a compact header with the document name, Exit focus, optional tools and native window controls. The save indicator, failure alert and Retry remain accessible. This review applies AGENTS.md to the changed screen; browser observations do not establish native WebView2 frame latency.

## A. Feel audit

| Area | Browser assessment | Evidence |
| --- | --- | --- |
| Response | 4/5 | Existing immediate button press styles; `toggleFocus` commits state without an animation completion gate. Keyboard and pointer checks pass. |
| Directness | 4/5 | Full workspace width, retained drawing toolbar and contextual properties. No automatic pan/zoom or geometry rewrite. Editor/canvas identity and text selection stay intact. |
| Interruptibility | 4/5 | Rapid repeated Focus toggles pass; buttons stay available. Existing CSS grid transitions retarget from their displayed layout. No velocity-preserving spring is claimed. |
| Spring behavior | N/A | No new spring or release gesture. Existing grid layout interpolation is retained, with the limitation described below. |
| Spatial consistency | 4/5 | Supporting panels use their existing left/right paths, dimensions and inert handling. Editor grows within the same panel. |
| Materials | 4/5 | Inspected light/dark screenshots use existing solid surfaces, theme tokens, borders and quiet shadows. |
| Reduced motion | 4/5 | Minimum-window checks pass with reduced motion. Existing CSS preference disables transitions; no new JavaScript animation controller exists. |

Native timing, live native window controls and target-display perception: **[NEEDS INPUT]** from a Windows/WebView2 visual run. Browser tests simulate maximized styling, not native maximization.

## B. Interaction redesign

1. Click Focus or press Ctrl+Shift+F. Preserve document selection; if a soon-hidden control owns focus, move it to the Focus button first. Close app action popovers and the engine Library drawer.
2. Hide Sidebar and Reference through the existing panel state/inert mechanism. Preserve their visibility preferences for exit. Expand the active document to the available width and remove title/date/options, branding, Reference/theme actions, weekly actions and secondary footer counters/exports.
3. Keep drawing tools, contextual properties, zoom/Undo, local canvas menu and save feedback usable. Notes keep their content and native scrolling. No canvas fitting, scrolling reset or editor remount occurs.
4. Board actions or Formatting reveals the existing secondary controls immediately. The button exposes pressed/expanded state and the controlled region. Hiding those controls first returns their keyboard focus to the owner; mouse interaction preserves editor selection.
5. Exit focus, Ctrl+Shift+F or root Escape restores the normal screen immediately at the semantic level. Engine-owned Escape continues to cancel its local interactions first. A second toggle can reverse an in-progress layout transition.

Custom drag boundaries, velocity projection and rubber-banding are N/A. Existing image/canvas manipulation and native scrolling remain owned by their current implementations. Save progress/failures and archive read-only context remain visible; permanent deletion is available after exiting Focus.

## C. Motion spec

No new position animation, keyframe or spring is introduced. The existing `.workspace` grid-column/gap interpolation remains the sole layout owner: 230 ms ease from current responsive columns to zero supporting columns, with existing 170 ms panel opacity. This existing layout animation is an exception to the transform/opacity preference because document width must change; it is not presented as a velocity-preserving physics spring. There is no release velocity handoff, overshoot, bounce or document scale.

New chrome reductions and optional control reveals use `display: none`/normal layout instantly. Hidden controls have no keyboard or pointer targets. Reduced motion retains direct input and commits final layout with the existing global transition override. Motion can be disabled by the runtime CSS preference; no new animation controller needs separate JavaScript observation.

## D. Materials and hierarchy

Reuse solid document, sidebar/topbar and engine chrome tokens, existing rounded panel geometry and theme shadows. No new palette, translucency, full-screen blur or scrim. The full-width content remains primary; compact save feedback does not obscure controls. Existing reduced-transparency fallback remains unchanged.

## E. Implementation and validation

- `src/App.tsx`: Focus owner, on-demand tools, focus transfer, retained panel preferences and hidden-title measurement guard. `src/styles.css`: full-width panel, compact header/footer and scoped hidden secondary controls.
- `src/BoardEditor.tsx`: close Library with a UI-only engine update (`CaptureUpdateAction.NEVER`); preserve engine instance/history. `src/NoteEditor.tsx`: stable formatting-region ID; editor remains mounted.
- No new dependency, per-frame React work, drawing mutation or saving/animation coupling.
- Four behavioral Focus tests cover light/dark, full width, contextual tools, rapid reversals, 850×600 with large elements/150% text, reduced motion, simulated maximized styling, focus restoration, retained editor/canvas/selection, formatting and save failure/Retry.
- Development: all four Focus checks passed; broader board, image and save run passed 32 applicable checks, with two production-only checks skipped. Nine existing board-design checks also passed in the initial run. An early Focus assertion measured layout before the existing transition settled; replaced with polling the final width relationship.
- Production build, focused production regressions and installer verification are recorded in `tests/verification.md` and `release/focus-verification-1.3.1.json` when complete.
- Screenshots inspected: `release/focus-board-light.png` and `release/focus-board-dark.png`. Native WebView2 visual/frame behavior remains untested.

## F. Screen-specific decisions

Keep the minimal title, Exit focus, optional tools, Windows window controls, essential drawing interactions and truthful save/error state. Reveal secondary commands on demand and restore normal chrome on exit. Do not remount content, auto-fit the drawing, hide persistence failures, animate live text scale, introduce synthetic scrolling, or delay commands until motion settles.
