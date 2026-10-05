# Notify: agent guidance

## Scope and product context

This file applies throughout this project. Apply the design and motion guidance when creating, changing, or reviewing frontend interfaces. Scale the review to the requested change; do not turn documentation or backend work into an unsolicited UI redesign.

Notify is a personal Windows notebook with a browser preview. Its primary task is writing while navigating folders and keeping a second note visible for reference. Design interfaces that feel like an extension of the user: immediate, predictable, interruptible, and quietly physical. Translate the supplied Apple fluid-interface principles to this app's webview without replacing its Windows conventions or visual identity.

- Platform: Tauri 2 on Windows/WebView2; Vite browser preview.
- Stack: React 19, TypeScript, plain CSS, Tiptap 3, Phosphor icons; Rust and local PostgreSQL in the desktop app. Browser preview uses local storage.
- Primary surfaces: folder/note sidebar, central editable document, read-only Reference panel, topbar, formatting toolbar, anchored menus, Settings/folder/deletion dialogs, save status, and toasts.
- Interaction focus: button feedback, Sidebar/Reference/Focus toggles, note selection, formatting, menus, dialogs, folder/note reordering, and note transfers between folders. Sidebar dragging uses native desktop HTML drag-and-drop with keyboard alternatives. Carousel, PiP, and touch sheets are not existing product requirements.
- Goal: make existing work feel direct and reversible while preserving text selection, keyboard access, editor focus, scrolling, and reliable saving.

Read the relevant implementation before changing it:

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | App shell, panel state, navigation, menus, dialogs, desktop window controls |
| `src/styles.css` | Light/dark tokens, layout, responsive rules, materials, motion preferences |
| `src/NoteEditor.tsx` | Tiptap editor, formatting, editable/read-only behavior |
| `src/SelectionColors.tsx` / `src/textColors.ts` | Selected-text color popover, keyboard access, validated semantic text/background marks |
| `src/HighlighterTools.tsx` / `src/InkLayer.tsx` / `src/NoteInk.ts` / `src/inkData.ts` | Guided/free pen and marker controls, captured drawing, block-anchored persistence, validated stroke data |
| `src/ImageBlock.ts` / `src/ImageBlockView.tsx` / `src/imageFiles.ts` | Embedded raster image blocks, resize/move/menu controls, local image validation |
| `src/useSidebarDrag.ts` / `src/sidebarOrder.ts` | Native sidebar dragging, drop feedback, keyboard moves, persisted array order |
| `src/useFileDrop.ts` / `src/importFiles.ts` | External file-drop destinations, text/code/PDF/DOCX parsing, import limits |
| `src/useWorkspace.ts` | Workspace updates, autosave, persistence state |
| `src/storage.ts` | Desktop/browser storage and export integration |
| `package.json` | Installed dependencies and available scripts |

These describe the inspected baseline, not a guarantee that future code stays identical. Recheck the relevant files. Motion/Framer Motion is not currently installed; do not assume its APIs are available or add a dependency solely to animate a simple button.

## Focused implementation, testing, and repository hygiene

Keep work proportional to the requested fix or feature. Minimize token use, execution time, and maintenance overhead by reading relevant files, making the smallest coherent change, and validating its actual impact.

- Add or run tests only for critical behavior affected by the change or its direct dependencies. Critical behavior includes writing/editing, saving and recovery, data integrity, import/export, destructive actions, and essential navigation or accessibility. Do not exercise all of these for every task; select only the affected paths.
- Prefer existing focused tests and runner filters. Add a regression test when it catches a meaningful failure introduced or fixed by the task. Do not add tests for trivial styling, implementation details, copied constants, tests of tests, or redundant checks already covered by the compiler or an existing test.
- Do not run unrelated suites, full regression passes, coverage sweeps, benchmarks, or repeated checks by default. Broaden validation only when a changed shared dependency, observed failure, or concrete integration risk justifies it, or the user requests it. Once relevant checks pass, stop unless subsequent edits affect their result.
- For frontend code changes, run `npm run build` once after the final relevant edit. For Rust changes, use the applicable Cargo check and targeted tests. Documentation-only changes need a content/diff review. Do not run app builds or tests for documentation edits.
- Keep the repository root free of ad hoc test/check/protection scripts, result files, logs, screenshots, and generated reports. Use existing test directories for durable tests and an ignored output directory or the system temporary directory for disposable artifacts. Remove only temporary artifacts created by the current task; preserve others' work.
- Reuse the existing test framework and project tooling. Add a helper, dependency, validation layer, or permanent report only when it has a concrete benefit to the affected app behavior. Avoid speculative protection layers, duplicate validation, and scaffolding for hypothetical future needs; preserve checks that protect real input and persistence boundaries.
- Follow idiomatic practices for the language and framework in use. In TypeScript/React, use precise types, explicit state ownership, correct hook dependencies, and effect cleanup; avoid unnecessary `any`, assertions, and derived state. In Rust, use ownership/borrowing, `Result`/`Option`, and explicit error handling; avoid unnecessary clones and panics on recoverable errors. Prefer standard APIs, existing conventions, and configured formatters/linters over new abstractions or tooling.
- Report validation briefly: what relevant check ran, its outcome, and any material unverified behavior. Do not create a separate audit, checklist, or results document unless requested or required by an existing project workflow.

## Preserve the current design language

- Keep the three-panel hierarchy: writing is primary, navigation supports it, Reference is secondary. Focus mode removes supporting panels without changing the note.
- Reuse semantic CSS variables instead of inventing a new palette: `--bg`, `--panel`, `--chrome`, `--sidebar`, `--fg`, `--text`, `--muted`, `--line`, `--accent`, `--active`, `--hover`, `--shadow`, `--green`, and `--danger`.
- Preserve cool blue-gray chrome, bright blue actions/selections, solid reading surfaces, subtle borders, generous document space, and restrained shadows. Check both light and dark themes.
- Keep the Segoe UI/system font stack and regular-weight Phosphor icons. Do not import Apple fonts or substitute macOS window controls.
- Follow existing geometry: 25px panel/topbar radii, smaller rounded controls, and the 32px window radius that becomes 0 when maximized. Derive new geometry from neighboring components.
- At the default desktop size, Sidebar is 294px and Reference is 345px, with 10px panel gaps. Existing media queries change these widths; measure current geometry rather than hard-coding one desktop size into motion.
- Keep the editor readable through viewport changes. Do not introduce permanent overlay chrome, glass behind body text, or decorative motion while typing.

## Core idea and human needs

Motion must start from the current on-screen value, accept new input immediately, and preserve meaningful velocity when a user releases a gesture. A user must be able to grab, reverse, or dismiss a moving surface without waiting for it to finish. Springs are useful because they model this behavior; animation is subordinate to the interaction.

- Safety/predictability: keep spatial paths stable, expose save failures, preserve drafts, and retain confirmation for permanent deletion.
- Understanding: make selected notes, active formatting, panel visibility, and menu ownership clear in intermediate frames.
- Achievement: react immediately to editing and commands; show successful saving only when persistence reports success.
- Joy: use small, coherent responses that reinforce actions. Avoid celebratory movement in routine writing.

## Interaction rules

1. **Response:** show a press highlight on pointer-down, ideally in the next painted frame. Keep activation on normal click/keyboard semantics; pressing must not prematurely create, archive, export, or delete a note. The existing `button:active` translate is a baseline; remove transform transition delay from the press-in path where necessary.
2. **Direct manipulation:** for a requested custom drag, track displacement 1:1 after recognition, preserve the grab offset, and capture the active pointer. Do not turn editor text, folder labels, or the entire window header into custom gesture surfaces.
3. **Interruptibility:** never disable input just to finish an animation. Retarget the running spring from its live value and velocity; do not restart from a canned initial pose. Preserve semantic state independently of the animation.
4. **Behavior over animation:** use critically damped, non-overshooting springs by default. Bounce is allowed only for a momentum-carrying drag where overshoot communicates a useful boundary. Buttons, menus, note selection, and destructive dialogs must not bounce.
5. **Velocity handoff:** a release continues with the pointer's recent velocity in the animated axis. Do not reset it to zero or confuse pixels per millisecond with pixels per second.
6. **Momentum projection:** for a drag with snap targets, project the resting position from exponential velocity decay before choosing the nearest valid target. Selecting the nearest target from release position alone is insufficient.
7. **Spatial consistency:** Sidebar leaves and returns on the left; Reference leaves and returns on the right. Menus originate near their trigger. Dialogs enter and exit around the same center. Use matching geometry on reversal; springs handle the current state without a separate opposing ease.
8. **Outcome hints:** reveal the destination during the transition through panel edges, selected toggle state, or a valid drop target. Keep text and action labels understandable mid-flight.
9. **Edges:** rubber-band only custom gesture-controlled surfaces. Retain native scrolling in the document, sidebar, and Reference; do not add synthetic overscroll to Tiptap.
10. **Recognition:** highlight immediately; start a custom drag after approximately 10 CSS pixels of displacement. Evaluate competing tap/drag/scroll intentions until one wins, then cancel the others. Scope `touch-action` to the gesture handle and preserve native scrolling on the other axis.
11. **Smoothness:** prefer transform/opacity, avoid per-frame React rerenders and read/write layout thrashing, and profile the actual webview. Keep travel short enough that moving text remains legible. There is no universal pixel delta that guarantees freedom from strobing; verify on target displays.
12. **Materials:** use translucency selectively for floating chrome, not as the app's default surface. Never stack light glass on light glass. Dim for modal focus; separate nonmodal surfaces with borders and restrained shadows. Materialize floating surfaces through subtle scale and optional blur rather than an unexplained plain fade.
13. **Feedback:** visual, sound, or haptic feedback must be causal, useful, and synchronized with the action. Do not add sound to typing/saving or pretend a webview can supply unsupported haptics.
14. **Reduced motion:** every new animation needs an instant or short opacity-only alternative. CSS preferences do not stop JavaScript springs; observe `prefers-reduced-motion` in the animation controller and respond to preference changes.

## Motion specification

The following are project starting values for a future spring implementation, not existing behavior or exact conversions of Apple's APIs. Use one motion owner per property. If Motion is introduced, verify its installed API and use a physics spring (`type: "spring"`, `mass`, `stiffness`, `damping`, and release `velocity`) for gestures. Do not mix physics parameters with duration/bounce options and assume they all take effect.

| Interaction | Properties and path | Initial physics values | Reduced motion |
| --- | --- | --- | --- |
| Button press | Immediate highlight; optional 1px down translation; return to 0 | Return only: mass 1, stiffness 500, damping 45; no bounce | Highlight only |
| Sidebar/Reference toggle | Short left/right reveal using clipped wrapper and translation; opacity 0 to 1 | mass 1, stiffness 300, damping 35; no bounce | Commit final layout instantly |
| Focus mode | Coordinate both panel exits and editor geometry as one layout change | Same panel spring; no bounce | Final layout instantly |
| Note/folder menu | Trigger-facing origin, translateY 4px to 0, scale 0.98 to 1; opacity | mass 1, stiffness 400, damping 40; no bounce | Instant, or opacity up to 100ms |
| Settings/folder/delete dialog | Centered, translateY 8px to 0, scale 0.98 to 1; opacity | mass 1, stiffness 400, damping 40; no bounce | Instant, or opacity up to 100ms |
| Folder disclosure caret | Rotate around its center, preserving current angle | mass 1, stiffness 300, damping 35; no bounce | Instant angle change |
| Toast | TranslateY 8px to 0 and opacity; keep its existing horizontal centering | mass 1, stiffness 400, damping 40; no bounce | Instant appearance/dismissal |

Opacity may use a short 100-150ms interpolation independently of the position spring. It must still accept interruption. Text selection and caret position must remain stable; never visibly scale the live document to fake a layout resize.

The supplied inspiration suggests damping ratio/response references of 1.0/~0.4s for repositioning, 0.8/~0.4s for rotation, and 0.8/~0.3s for sheets. These are reference feel targets, not raw Motion `damping` values or verified universal Apple defaults. Notify intentionally uses non-bouncy defaults for its writing surfaces. Response is not a guaranteed settle duration.

### Panel layout and reversal

- Keep final grid dimensions consistent with current breakpoints. Do not move a visually hidden panel over the editor while leaving its hit targets active.
- Prefer clipped panel transforms for reveal and a coordinated layout mechanism for the editor's geometry. If layout size must animate, isolate and measure that work; document the exception to transform/opacity preference.
- Existing `.workspace` grid-column/gap transitions can cause repeated layout work. Do not add a second spring fighting those transitions. Replace the relevant transition only when implementing and validating the replacement.
- On a second toggle during entry/exit, retarget from the displayed position and velocity. Keep the toggle usable throughout.
- Move focus out of a panel before making it inert/hidden. During exit, remove its hidden descendants from keyboard and pointer interaction; on re-entry restore interaction without waiting on an arbitrary timer.
- Preserve editor instance, active note, selection, scroll position, and autosave. Opening Reference must not steal editor focus.

### Custom gestures, only when requested

The existing sidebar uses native HTML drag-and-drop: the browser owns its threshold, grab offset, preview tracking, and cancellation. Use precise hit-tested insertion slots for reordering and explicit folder targets for transfers; do not fling notes into another folder based on momentum. Keep `dragDropEnabled: false` in the Tauri window configuration so Windows WebView2 delivers frontend drag events. The following capture/spring requirements apply to custom Pointer Events gestures, not the browser-owned drag preview.

- On pointer-down, store `pointerId`, start coordinate, live presentation position, and grab offset. Stop or retarget the existing spring without resetting position.
- Once displacement passes the 10px threshold on the intended axis, call `setPointerCapture(pointerId)` on the handle. Ignore unrelated pointers, cancel tap activation, and update a motion value in the next animation frame.
- Estimate release velocity from recent timestamped samples (roughly the last 80ms), in CSS px/s. Filter implausible spikes without erasing meaningful direction changes.
- For a starting projection model use `v(t) = v0 * exp(-t / tau)`, `tau = 0.2s`, so `projectedPosition = releasePosition + v0 * tau`. Choose the nearest valid snap target from that projection; pass actual release velocity into the settling spring. Tune projection against observed gestures.
- For out-of-bounds distance `d`, a starting rubber-band curve is `sign(d) * L * abs(d) / (L + abs(d))`, where `L = 48 CSS px`. Add that offset to the boundary; return to a valid target on release. Apply resistance once, not on top of a library's drag elasticity.
- Handle `pointercancel`, lost capture, Escape, unmount, and window blur. Clear pressed/dragging state and return to the last valid target without committing a drop or destructive action. Release capture when held.
- Under reduced motion, keep direct pointer tracking but settle instantly on release; remove inertia and decorative overshoot. Provide a keyboard/button alternative for every drag outcome.

### CSS animation boundaries

Do not use CSS keyframes or fixed-duration transform transitions for gesture-driven position, drag release, momentum, or a transition that must be grabbed/reversed. Existing `reveal`, `modal-in`, and `toast-in` keyframes are baseline behavior; migrate touched interactions when interruptible entry/exit is part of the requested work. Keep an exiting surface mounted only as long as needed, with correct focus and hit testing.

CSS hover/focus/color transitions and a loading spinner remain appropriate where they are independent of gesture physics. Reduced motion must retain a readable loading label even when the spinner stops.

## Materials and hierarchy

| Surface | Material | Scrim and depth |
| --- | --- | --- |
| Document and Reference content | Solid theme tokens for reliable text contrast | No scrim; existing subtle panel shadow/border |
| Sidebar and topbar | Existing solid tinted tokens by default | No scrim; retain `--shadow` |
| Note/folder menus | Solid `--panel` by default; optional tinted translucency only if contrast remains stable | No visual scrim; small floating shadow, baseline `0 14px 35px #11182725` |
| Settings/folder/delete dialog | Solid `--panel`, 23px baseline radius | Modal scrim; large shadow, baseline `0 24px 80px #091b4344` |
| Modal backdrop | Existing tinted dim layer and 8px backdrop blur | Baseline `#0b183944`; test contrast in each theme |
| Toast/save state | Compact solid feedback with semantic text | No full-screen dimming; do not obscure editing controls |

If translucency is justified for floating chrome, start with a theme-tinted surface at 90-96% opacity and backdrop blur of 8-12px. Supply a solid fallback for unsupported `backdrop-filter` and reduced transparency. Keep shadows theme-aware. Larger overlays may carry more depth than menus; ordinary panels must stay visually quiet.

Avoid animating full-screen backdrop blur. If materialization blur is needed, limit a small overlay's content blur to 2px down to 0 and profile it; scale/opacity alone is the preferred lower-cost default. Keep dialog text sharp once interactive. Preserve the existing reduced-transparency fallback and extend it to any newly translucent surface.

## Required review format for substantial UI work

Use A-F when the task requests an interaction audit/redesign or changes motion across a screen. For small fixes, record only relevant decisions and validation. Mark unresolved information as `[NEEDS INPUT]`; distinguish proposed behavior from implemented and measured behavior.

### A. Feel audit

Score 1-5 for response, directness, interruptibility, spring behavior, spatial consistency, materials, and reduced motion. Use 1 for absent/broken, 3 for usable with gaps, and 5 for verified coherent behavior. Cite concrete selectors, handlers, files, or observed interactions. If not observed, state `[NEEDS INPUT]` rather than invent a runtime score; use N/A for gestures the screen does not have.

Baseline evidence to recheck: `button:active` and its transform transition; `.workspace` grid transitions; conditionally mounted menus/dialogs in `App.tsx`; `reveal`/`modal-in` keyframes; the modal's solid panel plus blurred backdrop; global reduced-motion/reduced-transparency media queries; native sidebar drop markers and keyboard moves in `useSidebarDrag.ts`. No spring or custom Pointer Events drag controller currently exists.

### B. Interaction redesign

For the primary interaction, specify the pointer/keyboard happy path step by step, interruption/reversal, boundaries or rubber-banding, focus behavior, and reduced-motion fallback. For the Reference toggle: highlight press, commit toggle state, reveal from the right, preserve editor selection, allow immediate reversal, and settle to responsive width. Edge/rubber-band behavior is N/A until a drag is requested.

### C. Motion spec

List properties, origins, start/end geometry, exact spring parameters, opacity timing, whether bounce is allowed, velocity units/handoff, and prohibited CSS keyframes. Explain any layout animation exception. Do not write only "make it smooth" or translate Apple's damping ratios directly into a library's damping coefficient.

### D. Materials and hierarchy

Identify solid/translucent surfaces, scrim decisions, theme-aware borders/shadows, blur cost, and reduced-transparency fallback. Keep readable content solid and preserve the document's priority.

### E. Implementation checklist

- Reuse existing state, theme tokens, icons, breakpoints, and component boundaries.
- Implement immediate press feedback without changing action activation semantics.
- Keep editor focus/selection, keyboard shortcuts, read-only Reference, and save/error behavior intact.
- Use one animation controller per property, live values on interruption, and cleanup on unmount.
- If a custom gesture is required, implement capture, grab offset, hysteresis, velocity sampling/projection, cancellation, bounds, and keyboard alternatives.
- Support runtime reduced motion in JavaScript, CSS motion preferences, and material fallbacks.
- Validate only the interactions and configurations affected by the change: rapid toggling, dismissal/reopening, keyboard focus restoration, text selection, scrolling, themes, window sizes, or maximized geometry as applicable.
- Follow the focused testing policy above. Inspect available tests and select relevant files or cases before invoking a test runner; a script alone does not prove relevant tests exist.
- Check affected browser behavior and the Tauri webview when available; label any relevant untested native behavior. Documentation-only changes need a content review, not an app build.

### F. Screen-specific do / don't

Do:

1. Let users reverse Sidebar/Reference/Focus transitions with another click immediately.
2. Anchor note and folder options to their own ellipsis triggers and keep menus inside the viewport.
3. Keep formatting state visible and preserve Tiptap selection when using toolbar commands.
4. Show save progress/failure truthfully without delaying keystrokes or flashing success for every character.
5. Use the existing blue selection, quiet chrome, and solid document surfaces in both themes.

Don't:

1. Bounce document text, selection rows, permanent-delete confirmations, or routine button presses.
2. Capture editor pointer events for panel drags or replace native text scrolling with synthetic physics.
3. Wait for exit animation before accepting a panel toggle, menu dismissal, or Escape.
4. Add stacked glass panels, loud shadows, or sound effects to everyday note writing.
5. Remount the active editor or tie saving/data mutations to animation completion callbacks.

## Attribution

Adapted from the user-supplied [AI UX Playground fluid-interface prompt](https://aiuxplayground.com/prompts/design-apple-style-ui) and the inspected Notify implementation. This is project guidance, not an official Apple HIG specification. Do not invent HIG page numbers or claim supplied spring references are verified API defaults.
