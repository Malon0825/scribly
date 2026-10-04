# AnimateIcons integration

The user's explicit request to use AnimateIcons takes precedence over AGENTS.md's default Phosphor-only guidance. Version 1.3.5 initially integrated eight shell icons. Version 1.3.6 extends actual `@animateicons/react` 0.10.0 components to Search, folders/note rows, creation/disclosure/options actions, Archive, formatting, Highlight/Draw, enabled Undo/Redo, pickers, Reference commands, import/export/copy, image/code actions, theme choices, dialog close and board commands. Forty-two individual Lucide subpaths share the existing bundled runtime. Status checks, empty-state art, destructive actions, native window controls and engine drawing-tool icons keep their prior behavior. No full catalog import, copied animation implementation or separately installed Motion package.

Primary sources inspected: [AnimateIcons](https://animateicons.in/), [source/README](https://github.com/Avijit07x/animateicons), package README/types and the actual pinned distribution. The package bundles Motion. Repository size limits are configured limits, not app measurements; before/after production artifact sizes are recorded separately. New notices include AnimateIcons, its icon-shape sources and bundled Motion.

## A. Feel audit

Existing pointer-down button highlight remains immediate. Icon motion stays local: labels, button geometry, editor and panels remain stable. Browser checks cover finite animation, cancellation, keyboard input, idle frame requests and runtime reduced motion. Native WebView2 frame time and target-display perception are **[NEEDS INPUT]**. Direct manipulation/release momentum are N/A; no new gesture is implemented.

Browser-only feel scores; these do not claim native runtime observation:

| Criterion | Score | Evidence |
| --- | --- | --- |
| Response | 5 | Existing button press remains immediate; creation tests distinguish pointer-down from activation. |
| Directness | N/A | No new gesture or movable surface. |
| Interruptibility | 4 | Imperative stop on exit/blur and preference changes restores the icon; library timelines do not promise velocity-preserving spring reversal. |
| Spring behavior | N/A | Finite authored SVG timelines; no spring controller added. |
| Spatial consistency | 5 | Fixed icon boxes preserve sidebar alignment and Focus canvas identity across interactions. |
| Materials | 5 | Current solid theme surfaces and colors remain; light/dark screenshots inspected. |
| Reduced motion | 5 | Browser tests toggle preferences during animation, verify static poses and re-enable animation. |

## B. Interaction

The whole button triggers one library sequence on mouse/pen entry or visible keyboard focus. Search supplies a noninteractive owner wrapper so input focus and hover share the same controller without making the field a button. Moving across icon/label does not restart it; hovering and focusing the same control share ownership. Exit/blur requests the library's normal pose. Native drag start cancels decorative hover without capturing pointers or changing native drag thresholds. Disabled/inert controls do not start animations. Touch hover is excluded. Commands retain normal click/keyboard activation and never wait for animation. Backgrounding/window blur cleans up ownership; unmount removes control/window/document listeners. Reduced motion disables triggers and remounts only the decorative icon into its complete normal pose, preserving the active editor, selection and control semantics.

The bundled reduced-motion hook captures its shared value on mount. A single shared app preference subscription notifies after the media-event batch using a cleaned-up zero-delay timer so remounted components see the new cached value. CSS immediately clears transforms/opacity/dash offsets while that update runs. Both preference directions are tested.

## C. Motion spec

Use the library's authored finite SVG sequences with `duration=0.45`; no repeats are added. Plus uses a 225ms 90° turn/pulse; Sidebar's divider moves within 315ms; Reference's page flexes within 360ms; Focus's rings pulse over 225–315ms; Settings turns its gear over 405ms with a 270ms center pulse; Theme uses 450ms sun motion or a 360ms moon sequence; Workflow draws its connection and pulses its nodes, completing within roughly 405ms.

These are library SVG timelines, not physics springs or momentum-preserving drag transitions. They accept immediate cancellation via the imperative stop API. Some icon sequences deliberately pulse or reverse internally, as requested by selecting this library; buttons, labels, document text and destructive controls do not bounce. No second CSS transform animation, keyframe or custom spring competes with the library. No saving or activation is coupled to animation completion. Reduced motion is static with immediate CSS fallback and decorative-icon-only remount.

The 1.3.6 icons use the same `duration=0.45` scale factor for their authored sequences, including short path tracing, stroke changes, turns and translation. It is not a promise that every sequence lasts exactly 450ms. The selected published modules were inspected: none adds `repeat` or `Infinity`. No spring/velocity handoff, animated layout dimensions, document scaling or new CSS transform/keyframe owner is introduced. Native sidebar dragging and image resizing keep their own direct manipulation; icon animation does not commit mutations.

## D. Materials and hierarchy

Keep current theme colors, solid surfaces, Phosphor icons elsewhere, Windows chrome and geometry. Selected AnimateIcons use currentColor and their outline style. The wrapper preserves the original icon size and is decorative/noninteractive. No blur, glass, shadow change, permanent layer promotion, loading/save celebration, or animation of destructive/window controls.

Note-row color rules include the decorative wrapper so active notes retain the existing accent. Search, pickers, toolbar labels and menu spacing retain their dimensions. No changes to panel material, scrims, backdrop blur or transparency fallbacks.

## E. Implementation and performance boundaries

`AnimatedIcon.tsx` handles whole-button triggers through an imperative ref and a small listener set per opted-in icon. Default library hover handlers are disabled to avoid duplicate triggers. `animated-icons.css` supplies plain-CSS geometry for the package's utility-class wrappers and immediate reduced-motion fallback. No React state or app renders are updated per animation frame; the shared bundled runtime owns frames. Idle/settled RAF request counts are instrumented in browser tests. Native peak RAM/compositor behavior/frame latency remain unmeasured.

Development preparation includes the eight subpaths, avoiding surprise dependency optimization/reloads on first use. Source imports and production bundle checks confirm the implementation includes the selected icons/runtime rather than the catalog. Tests verify creation timing, no idle loops, cancellation, preference changes, keyboard feedback, retained editor instance/selection and existing Focus/sidebar layout. Initial checks exposed an extra label-span selector conflict (wrapper changed to a div) and the cached preference issue (fixed before final verification). Cold development navigation under concurrent native compilation exceeded short harness timeouts; production checks use the built assets.

Final build/test counts, bundle-byte difference and installer hashes are recorded in `release/animateicons-verification-1.3.5.json` and `tests/verification.md`.

Final verification: 12 development checks and 34 final production checks passed. TypeScript/Vite, optimized Rust and NSIS packaging passed; the copied installer matches the generated bundle. All 421 tested frontend asset hashes and 14 task source/config/license hashes match. Three unrelated highlighter source files were edited concurrently after the frontend build; those edits are preserved in the workspace, while this verified installer retains the tested frontend snapshot. The versioned `release/animateicons-1.3.5/` copy preserves this artifact alongside parallel builds. The installed notebook was not modified.

The initial integration build increased the production JS artifact sum by 72,338 bytes (24,498 bytes when each artifact is gzip-compressed). A concurrent highlighter correction landed during packaging, so packaging was restarted to include the current sources. The final release increases the artifact sum by 76,343 bytes (25,762 bytes gzipped), from 7,379,510 to 7,455,853 raw bytes. These compare workspace builds, including the highlighter correction; they are artifact-byte measurements, not isolated library-cost or controlled startup/RAM benchmarks. Existing large Mermaid/Excalidraw chunks remain lazy. The installed package's unpacked size is not the amount shipped to the browser. Browser instrumentation verifies no additional requested animation frames over a 300ms idle observation after settling; it does not measure WebView2 memory or compositor cost.

## F. Do / don't

Do keep explicit imports, finite whole-control reactions, keyboard parity, reduced-motion support and cleanup. Don't animate background rows or canvas paths, loop at idle, delay commands, remount documents, pretend the bundled runtime is free, or claim unmeasured native RAM/frame improvements.

## Expanded coverage verification — 1.3.6

The user's follow-up explicitly requests hover motion on the remaining app icons, including sidebar rows. Only the hovered/focused row plays a finite sequence; rows do not animate on mount, selection or saving. The browser feel scores above also apply to this coverage extension; no new gesture/spring/layout behavior is introduced. Existing materials, hierarchy and screen-specific boundaries remain.

Eighty production checks passed across icons, formatting/colors, pen tools, image resizing/menu/persistence, code highlighting, Focus, board design, creation layout and native sidebar drag outcomes. Two image checks require Vite source-module interception/import; they passed in development and are now explicitly skipped in production preview. The initial broader run exposed these harness mismatches, not product failures. New checks cover every major added icon family, no early activation or hover editing, disabled controls, Undo/Redo, keyboard focus, preference changes, preserved editor selection and idle behavior with 250 rendered notes. Settings/Image dialog queries use the existing accessible titles. Excalidraw owns a separate frame loop, so board checks assert icon cancellation/return poses rather than equating engine frames to an icon leak. Both theme screenshots were inspected. The 21st review returned no errors, warnings or suggestions.

The final production JS artifact sum is 7,430,670 raw bytes / 2,300,792 gzip bytes, 25,183 raw bytes / 10,498 gzip bytes below the prior 1.3.5 workspace build. Removing replaced Phosphor imports and using per-icon AnimateIcons entry points keeps the shared runtime; no additional dependency was installed. Concurrent pen-UI changes are also in this workspace comparison, so this is not an isolated icon-cost or startup/RAM benchmark. Native WebView2 peak memory and frame latency remain unmeasured. Final installer and asset verification are recorded in `release/icon-hover-verification-1.3.6.json`.

TypeScript/Vite, optimized Rust release and NSIS packaging passed. The verified copy in `release/icon-hover-1.3.6/` matches the generated installer checksum, and all 421 tested frontend hashes match. Seventy-one tracked source/config files are unchanged; parallel pen UI/controller edits to HighlighterTools.tsx and InkLayer.tsx landed after the frontend build and remain in the workspace. This installer retains the tested frontend snapshot. The installer was rebuilt, not installed; the user's notebook was untouched.
