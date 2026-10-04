# Architecture boards: AGENTS.md design review

Reviewed 3 October 2026 for Notify 1.1.3. Inspected the actual board editor, import/export dialogs, read-only Reference, shared picker/dialog primitives, app focus handlers and responsive/theme CSS. Used the 21st UI review skill and disposable browser notebooks. This review preserves Notify's current design record: light blue chrome and blue actions in Light, the accepted charcoal/sand palette in Dark, Segoe UI controls and Windows window conventions.

## Proven gaps and corrections

| Finding | Implemented correction | Evidence |
| --- | --- | --- |
| The embedded engine still used Assistant and purple selection/surface tokens, including its portal dialogs | Map engine chrome to Notify's semantic colors, Segoe UI and existing floating/dialog shadows. Scope scene changes separately: authored fills, strokes and drawing fonts remain unchanged. | Computed font, foreground, toolbar background and selection match the app in Light, Dark and System; saved drawing fill remains unchanged after a theme switch. |
| New board controls and import/export text ignored parts of the element/text preferences | Scale new-board/header/command/role/preview controls with `--element-scale`; scale source, hints, messages and preview text with `--text-scale`. Keep SVG drawings independent of the global icon zoom. | Large controls and 150% text at 850×600; source and hint text render at the requested size. |
| Wrapped commands and inspector could squeeze a minimum-height canvas beyond its panel | Put commands/properties in a bounded, natively scrolling group; let the canvas use remaining space and keep save/error feedback outside that scrolling group. | Canvas stays above the visible save footer at 850×600 with the largest preferences; keyboard/pointer navigation reaches dialogs and controls. |
| Engine Help became invisible with reduced motion because its final opacity depended on a disabled keyframe | Make engine modal contents visible at their final geometry immediately. Use the neighboring dialog radius. The rule also covers engine portals outside the canvas. | Help opens, remains visible when the motion preference changes, and dismisses with Escape; normal and reduced-motion checks. |
| Engine dialogs referenced a nonexistent heading ID and had no accessible name | Extend the existing pinned, version-checked engine patch to reference the actual uniquely prefixed heading ID in both development and production. The patch verifies exactly one expected label/heading and fails if upstream changes. | Help is discoverable as a named dialog, in addition to its visibility/focus checks. |
| Canvas controls overrode immediate press timing; app board commands lacked a distinct press highlight | Remove transition delay on engine button press; give app command/preview buttons immediate themed press highlights. Activation remains on click/keyboard. | Pointer-down changes the highlight without opening the inspector; pointer-up activates it. |
| Closing Reference or invoking keyboard Focus inside it could leave focus on a now-inert control | Move focus to the visible owning topbar control before hiding the supporting panel. Pointer panel toggles preserve focus in the active document. | Reference close and Ctrl+Shift+F move focus correctly; opening Reference retains the note editor instance, selection and subsequent typing. |
| Preview scrolling lacked the app's visible keyboard focus treatment | Add an inset accent focus outline to the native scrolling preview. Announce board errors as alerts and normal export results as status. | Focused Reference preview has a visible outline; failure/retry regression checks still pass. |

## A. Feel audit

Scores describe browser observations, not measured WebView2 frame latency or target-display performance.

| Principle | Score | Implemented/observed evidence |
| --- | --- | --- |
| Response | 4/5 | `.board-top-controls button:active` and engine press rules apply without transition delay. Pointer-down does not perform the action. |
| Directness | 4/5 | Drawing and shape properties retain the engine's interaction owner; static Reference uses native scrolling. No new gesture recognizer or synthetic scrolling. |
| Interruptibility | 4/5 | Rapid Sidebar/Focus commands retain the same canvas and selected shape. Dialog Escape/cancellation is immediate and restores the trigger. |
| Spring behavior | N/A | No new spring or release animation. Engine drawing and native sidebar dragging remain their existing owners. |
| Spatial consistency | 4/5 | Board stays central, folders left, Reference right; hidden panels become inert. Shared pickers retain their anchored placement; dialogs stay centered. |
| Materials | 4/5 | Solid theme surfaces, semantic colors and restrained shared shadows, verified in Light/Dark/System. Authored canvas background remains scene data. |
| Reduced motion | 4/5 | CSS preference removes transitions/animations; Help is visible at final geometry even when that preference changes while open. |

Native drawing feel, precise latency, high-refresh displays and large-board WebView2 profiling: **[NEEDS INPUT]**. These are unverified observations, not blockers invented from the design guidance.

## B. Primary interaction and focus

1. Create a board in a folder using New board, the folder menu or Ctrl+Shift+N. The central document shows its title, commands and editable canvas.
2. Select/draw using engine tools; open Architecture on normal click or Enter/Space. Roles and boundary membership use ordinary buttons and the shared keyboard-accessible picker. On short windows, commands/properties scroll natively while the canvas remains visible.
3. Mermaid opens the shared centered review dialog. Keyboard users can inspect code, review warnings and acknowledge partial export before copying/downloading. Escape cancels immediately and returns focus to the trigger. Import/template preview remains required before creating a separate board; cancellation retains the original drawing.
4. Reference presents a static drawing with Fit/zoom and a focusable native scroll area. It owns no drawing shortcuts or editing tools. Opening Reference preserves the active writing selection. Closing it transfers focus to Reference; keyboard Focus transfers focus out before both supporting panels become inert.
5. Repeated panel commands are accepted during the existing layout transition. Canvas identity and selection survive. Persistence is independent of motion and retains truthful saving/error/retry feedback.

Bounds, rubber-banding and velocity handoff for new gestures: N/A. No new custom drag was requested or implemented. Reduced motion commits the layout directly and retains native scrolling and keyboard access.

## C. Motion specification

| Surface | Owner, geometry and timing | Reversal/reduced motion |
| --- | --- | --- |
| App board buttons | Existing CSS owner: immediate active highlight and the app's optional 1px down translation. Existing return is a 160ms transform/color transition. Engine buttons retain `transform: none`, with 100ms background/color transitions and 0ms press-in. | Input stays enabled; reduced motion removes transitions and transforms through the app baseline. No bounce, physics parameters or velocity units apply. |
| Engine dialogs | Instant `opacity: 1`, `transform: none`, `animation: none`; same center on entry/dismissal. Normal dialog radius derives from the shared 23px baseline. | Immediate Escape/dismissal; preference changes do not hide an open dialog. |
| Mermaid/import dialog and shared pickers | Existing shared primitives: no transform keyframes, at most 100ms opacity materialization. Menus originate at their triggers; dialogs stay centered. | Immediate dismissal and focus return; reduced motion removes opacity transitions. |
| Sidebar/Reference/Focus | Existing shell remains the sole owner: 230ms grid/gap layout transition and 170ms panel opacity/visibility. No second animation controller was added. | New commands retarget the current CSS layout; inert/focus state commits immediately. Reduced motion makes final layout instant. |

The shell's existing grid transition is a layout-work exception; it remains inherited behavior rather than a claimed spring implementation. Browser reversal/identity checks pass, but no target-webview performance measurement was made. There are no new gesture keyframes, momentum projections or spring parameters. Native sidebar drag remains browser-owned, and Tauri `dragDropEnabled: false` is retained.

## D. Materials and hierarchy

Commands use solid `--chrome`; properties and dialogs use solid `--panel`; borders/text/selection use `--line`, `--fg`, `--text`, `--muted`, `--accent` and `--active`. Engine chrome and portals reuse these tokens and `--floating-shadow`/`--dialog-shadow`. SVG previews and the live canvas keep their authored appearance. No glass is placed behind drawing or note text, and no sound/haptic feedback is added.

App dialogs retain the existing dim backdrop and static 8px blur. The existing reduced-transparency fallback removes blur. Engine dialogs retain their static dim scrim without introducing blur. No blur is animated. Engine modal contents stay solid. Window/maximized geometry and platform controls remain the existing app shell.

## E. Implementation and validation checklist

- Reused existing shell state, Phosphor context, Dialog, AppSelect, theme tokens, responsive rules and appearance preferences.
- Preserved normal activation semantics, canvas selection, note selection/typing, read-only Reference, native scrolling and existing saving/recovery behavior.
- No extra animation owner, animation-completion mutation or editor remount was introduced.
- Added nine behavioral browser checks in `tests/board-design.spec.ts`, including Light/Dark/System, press-before-activation, rapid toggles, minimum window with large preferences, keyboard focus, runtime reduced motion and engine dialog visibility.
- Verified all 145 applicable regression checks: the complete run passed 143 and skipped three production-only checks; two folder-copy checks interrupted by a tooling-triggered Vite restart both passed on the settled rerun. The final production run passed 53 and skipped four development-only injections/harness checks. All nine design checks passed in both development and production.
- TypeScript/Vite build passed. Review of eight UI files reported zero findings; global CSS review reported zero errors/warnings and 69 informational notices in existing palette definitions. Dependency audit reported zero vulnerabilities. The engine patch is idempotent, verifies the pinned distribution patterns and uses a patch-dependent optimizer cache so development serves the corrected engine.
- Build, regression/production results and installer details are recorded in `tests/verification.md` and `release/board-design-verification-1.1.3.json` after completion.
- Native pointer/clipboard/Windows file-dialog/IME behavior and large-board WebView2 performance: **[NEEDS INPUT]**. Browser automation does not establish native feel. The installed app and personal notebook are not changed by the checks.

## F. Board-specific do / don't

Do keep drawing authoritative, assign membership explicitly, retain focus/selection through supporting-panel changes, expose save failures and use native preview scrolling. Keep commands compact and theme-aware, with reachable controls at large text sizes.

Do not recolor authored diagrams through theme CSS, scale the live drawing to fake a layout change, remount the canvas for panel toggles, invent relationships during Mermaid conversion, bounce content, add synthetic overscroll or tie saving to animation completion.
