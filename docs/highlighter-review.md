# Note highlighter — 1.3.4

## A. Feel audit

Browser evidence, not measured WebView2 latency: response 4/5 (pressed toolbar state and next-frame tip preview in InkLayer); directness 4/5 (client-coordinate tracking, coalesced Pointer Events, capture, 2px sample spacing); interruptibility 4/5 (wheel reversal, Escape, cancellation, blur and document/geometry changes discard the draft); spring behavior N/A (ink is painted rather than an animated moving surface); spatial consistency 4/5 (block anchors, font-relative vertical coordinates and width-relative horizontal coordinates; image-frame geometry follows resizing); materials 4/5 (existing toolbar/ActionPopover tokens and translucent authored ink over solid reading surfaces); reduced motion 4/5 (direct tracking with immediate completion, existing instant popover preference). Native frame latency and pen hardware are [NEEDS INPUT].

## B. Interaction

Activate Highlight, then drag in the note. Guided joins the initial point to the live tip with a straight line at any angle; Free retains the sampled hand path. The pointer is captured immediately to retain release/cancellation, with a 10 CSS pixel movement threshold before a stroke can commit. A shorter tap leaves no saved mark. Wheel movement while drawing switches modes and prevents scrolling; retain accumulated raw samples so reversing to Free restores the path traveled. One switch per wheel burst, at least 120ms apart and after 40 pixel-equivalent deltas. Idle wheel scrolling and Ctrl+wheel zoom remain native. Holding the toolbar pen button while wheeling also switches the mode.

Commit one Undo transaction on pointer-up, then resume normal idle behavior. Escape discards a draft and deactivates the tool. Pointer cancellation/lost capture, blur, scrolling, resizing, document changes and unmount discard drafts. Existing text selection, native scrolling and image controls work when the pen is off. Options and mode buttons are keyboard accessible; Highlight selected text applies the marker color through the existing semantic background mark. Clear marker strokes is reversible with Undo. Reference renders strokes with no drawing controls.

Edges clip to the note surface; rubber-banding, inertia, velocity handoff and momentum projection are N/A for painting. Reduced motion retains direct tracking and immediate commit/cancel without decorative settling.

## C. Motion and geometry

Paint SVG paths through one ref-based controller in requestAnimationFrame, without per-sample React state changes. Guided has two endpoints; Free stores at most 512 samples per stroke, thinning older points when needed. Use a 16px × text-scale marker width, rounded ends/joins, 0.35 opacity and non-scaling SVG stroke width. No springs, overshoot, keyframes or position transitions control the brush. Existing menus use only their shared 100ms opacity entry and reduced-motion override.

Store validated numeric coordinates in data-note-ink on the owning top-level block: x divided by block width, y divided by note font size. Image strokes use the visible image frame. ResizeObserver tracks the surface and annotated blocks/frames, and serialization remains inside Tiptap's normal save/Undo path. Inserting a paragraph above retains annotations with the original paragraph; splitting does not duplicate them. These are geometric annotations, not semantic word attachments: changing wrapping or content within the anchor can shift a stroke relative to individual words. Semantic selected-text highlighting is available for word-level attachment.

## D. Materials

Reuse the solid toolbar and ActionPopover, 12px menu geometry, theme-aware border/shadow, system typography, Phosphor icons and immediate pressed state. No scrim, glass, blur or new animation dependency. Three intentionally authored marker tokens (yellow/green/pink) appear in the small picker. Reading surfaces remain solid; only marker ink has translucency.

## E. Validation

Checks cover guided/free painting, both directions of wheel switching, cancellation, Undo/Redo/clear, text selection, block insertion/splitting, image resizing, browser reload, read-only Reference, safe portable imports, both themes, minimum window size and reduced motion. Existing colors, Focus, menus and image behavior are checked in the production build. Native PostgreSQL diagnostics include marker HTML in exact save/restart equality. Detailed final counts and packaging hashes are recorded in tests/verification.md and release/highlighter-verification-1.3.4.json. Native drawing appearance and hardware pen/trackpad behavior remain unmeasured.

## F. Do / Don't

Do keep Guided usable at any angle; preview the actual tip before release; let wheel switches reverse mid-stroke; save each stroke as one Undo operation; keep Reference read-only.

Don't fling or bounce ink after release; take over wheel scrolling while idle; capture editor pointers when the tool is off; silently convert ordinary text into drawings; duplicate strokes when splitting paragraphs.
