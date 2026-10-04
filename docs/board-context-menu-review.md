# Board context menu — Scribly 1.3.2

The right-click surface in the user's screenshot is Excalidraw's DOM context menu inside the app, rather than a Windows-native menu. The app now styles that existing menu and adds scoped keyboard handling; the engine still owns action availability, execution, selected elements, Undo history, placement and outside dismissal.

## Relevant design decisions

- Match the app's ActionPopover: solid `--panel`, `--fg` text, `--line` border/separators, scaled 12px radius, `--floating-shadow`, Segoe UI and independently scaled text. Existing theme tokens provide light/dark colors. Keep shortcut hints muted and dangerous labels on `--danger`; do not recolor drawings.
- Reuse scaled 36px minimum rows, quiet rounded hover/focus surfaces and an inset accent focus ring. Pointer-down highlights immediately; commands activate on normal click/keyboard semantics, not press. No translation, bounce, new spring, blur, glass, scrim or dependency.
- Entry is a 100ms opacity-only interpolation through `@starting-style`. Dismissal is immediate. Runtime reduced motion removes the transition; CSS fallback shows final opacity when starting-style is unsupported. This scoped menu change does not introduce a screen-wide motion redesign.
- Preserve the engine's viewport fitting and scrollable popover. Width is bounded by viewport and scaled maximum; labels may wrap, shortcuts remain legible, and keyboard movement scrolls the focused command into view. Native scrolling remains intact.
- Arrow keys cycle enabled commands; Home/End select first/last. Escape dismisses and returns focus to the canvas without leaving Focus mode. Tab dismisses the nonmodal menu and proceeds from the canvas instead of remaining in the engine's generic Popover trap. Enter/Space retain native button activation while excluding the canvas label-editing/pan handlers. Other engine shortcuts remain unchanged.
- Use only the existing canvas React capture handler and a UI-only `CaptureUpdateAction.NEVER` scene update for dismissal. No observer, timer, retained subscription, extra React state or per-frame work.

## Validation

Four new behavioral checks cover both themes, immediate press without premature action, Duplicate/Delete through pointer/keyboard, Undo, canvas identity, keyboard navigation/focus, Tab/Escape/outside dismissal, Focus preservation, viewport-edge opening at 850×600 with large elements/150% text, native scrolling to the last command, and runtime reduced-motion changes.

The initial keyboard check caught Enter reaching the canvas and starting label editing. The scoped activation guard fixes that conflict; all 17 selected development checks then passed (context-menu, existing board design and Focus regressions). Light/dark screenshots were inspected. 21st catalog context-menu results were inspected; reuse of the engine menu and project tokens avoids another component or dependency. Final 21st review, production results and installer hashes are recorded in `release/context-menu-verification-1.3.2.json` and `tests/verification.md`.

Native WebView2 menu appearance and target-display frame latency remain untested. No blanket native performance claim is made; the user's installed notebook is not modified by these tests or packaging.
