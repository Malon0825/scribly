# Shell evidence audit (source review only)

Status scope: PASS means source proves the stated implementation; it does not mean browser, WebView2, NVDA or pixel measurement passed. This agent ran no tests or UI. Theme/size/DPI/open-state resilience, timings, visual contrast, body-scroll bleed, screen-reader announcements and rapid toggling are NOT VERIFIED unless a narrower source claim is explicitly stated below.

## Trigger inventory and A-0 profiles

Every shell surface inherits a profile below. Editor palettes, code/image menus, board overlays and logo/import dialogs are assigned to other audit agents.

| Surface | Source inventory | Profile / status |
|---|---|---|
| Filter All items | App.tsx:919-920; All/Notes/Boards | SELECT |
| Sort Manual | App.tsx:921-922; Manual/Modified/A–Z | SELECT |
| Reference note/board | App.tsx:1391-1398; all unarchived items | SELECT; long/large list performance NOT VERIFIED |
| Move note to folder | App.tsx:1213-1227; Unfiled + folders, nested in options | SELECT; parent closes on choice; focus destination code provided |
| Note font | AppearanceSettings.tsx:51-55; grouped fonts, availability hint/live preview | SELECT |
| Appearance topbar | App.tsx:822-834; Light/Dark/System | ACTION; selected state aria-pressed |
| Export formats | App.tsx:1329-1342 | ACTION |
| Sidebar note/board ellipsis | App.tsx:651-689 | ACTION; archive/restore, reference, permanent delete |
| Sidebar note/board right-click | App.tsx:620-625 | ACTION; exact same content as ellipsis; FAIL cursor anchoring |
| Folder ellipsis | App.tsx:1016-1078 | ACTION; rename/new board/import/copy-last/remove |
| Folder right-click; empty-sidebar right-click | App.tsx:978-1098; no handler | FAIL brief feature expectation; NOT an established WCAG failure |
| Active note/board options | App.tsx:1198-1267 | ACTION; move/duplicate/export/archive/delete (different actions from sidebar) |
| Ctrl+K/search field | App.tsx:363-367,899-916,970-975 | SEARCH |
| Settings | App.tsx:1149,1478-1487; SettingsContent.tsx | DIALOG; tabs, theme/size/text/font/startup/backup/about |
| Keyboard shortcuts | App.tsx:376-377,1475-1477 | DIALOG |
| New/rename folder | App.tsx:561-580,1494-1523 | DIALOG/RENAME |
| Remove folder | App.tsx:1066-1076,1527-1546 | DIALOG; data moved to Unfiled, no undo |
| Permanent-delete note/board | App.tsx:548-551,1529-1576 | DIALOG; specific title; danger confirm; says cannot undo |
| Import results | App.tsx:280-283,1488-1492 | DIALOG; per-file failures |
| File chooser | App.tsx:196-201,1583 onward | Native input; native/desktop behavior NOT VERIFIED; progress App.tsx:874-878 |
| Created/modified metadata | App.tsx:1182-1189 | Date picker N/A; created visible, both in native title; keyboard tooltip NOT VERIFIED |
| Native title tooltips | App.tsx:631,648,656,724,759,801,815,823,891,923,993,1048,1323; PanelResize.tsx:163 | TOOLTIP |
| Toasts | App.tsx:191-194,1449-1453 | TOAST |
| Folder disclosure | App.tsx:83-85,553-559,990-1007,1082-1097 | COLLAPSE |
| Pinned/Recently opened accordion | No shell implementation found | N/A (no product requirement established) |
| Note/board title rename | App.tsx:1162-1175 | RENAME (immediate save model) |
| Sidebar/Reference resize | PanelResize.tsx | RESIZE |
| Row hover-reveal controls | styles.css:2385-2409,2499-2500 | HOVER |

### SELECT full A-0

- Opening: PASS source portal/popover anchoring, 6px offset, 10px collision padding, label, visible caret (AppSelect.tsx:15-20). Exact latency, focus movement, hit areas and live collision behavior NOT VERIFIED.
- While open: Radix owns keyboard/typeahead/focus and scroll controls (AppSelect.tsx:2,22-32); NOT VERIFIED behavior rather than inferred pass from dependency name. PASS source selected checkmark and separate checked/highlighted styling (styles.css:2208-2210). PASS constrained height/viewport width (2185-2191). Text-size/theme/resize, simultaneous select behavior, selection preservation, disabled explanation NOT VERIFIED.
- Closing: Escape stops parent handling; optional close-focus callback (AppSelect.tsx:20-21). Outside, re-click, Tab, blur, item selection focus, exit animation and rapid reversal NOT VERIFIED. Source CSS opacity transition 100ms, reduced-motion none (styles.css:2183,2274-2275); no application exit retention.
- Semantics: PASS source accessible label/describedBy and Radix ItemText/ItemIndicator; live screen-reader count/position announcement NOT VERIFIED.

### ACTION full A-0

- Opening: PASS portal to body, constrained viewport size, clamped placement with above/below preference (ActionPopover.tsx:14-22,66). PASS first enabled button receives focus (42). PASS trigger aria-expanded/haspopup=dialog; source role dialog accurately describes button-action popover. Menu/menuitem semantics are a brief preference, not an automatic AA failure because button-dialog pattern can be valid. Correct cursor position FAIL on sidebar context trigger (App.tsx:620-625 never passes point). Pixel hit areas/latency/own-trigger occlusion NOT VERIFIED.
- While open: PASS source arrows/Home/End, disabled skipped, Enter/Space native buttons (ActionPopover.tsx:55-62); typeahead N/A for short action dialogs, submenu N/A. PASS single action owner via notify:action-open (25-28), ResizeObserver/window-resize placement (29-31), overflow-y auto (styles.css:2224). Theme/text/DPI rendering/scroll bleed/editor selection NOT VERIFIED. Scroll-into-view FAIL implementation uses preventScroll=true for arrow navigation (62), so an offscreen focused action is not actively revealed; reproduce with large text/short height before assigning runtime severity.
- Closing: PASS source Esc focus return and Tab dismissal (53-54), outside/ancestor-scroll dismissal (32-41); trigger re-click in App handlers. FAIL no window blur dismissal (effect registers no blur). FAIL no exit retention: conditional unmount in App.tsx:667,1034,1210,828,1335. Outside-click focus intentionally follows clicked target; body/focus stability NOT VERIFIED. Rapid open/close NOT VERIFIED.
- Semantics: labeled role=dialog (50), native named buttons; no aria-controls on shell ellipsis triggers. Screen-reader announcement NOT VERIFIED.

### DIALOG full A-0

- Opening: PASS labeled aria-modal dialog, named close control (Dialog.tsx:72-83); PASS initial focus logic exists (27-31), but first control is Close dialog (header preceding children). Source FAIL brief initial Cancel/new-folder-input expectation. Latency/jump/centering/target pixels NOT VERIFIED.
- While open: PASS Tab wrap only at first/last visible control (38-52); FAIL background never inert (App.tsx only inert on panel visibility at 886/1379; Dialog has none) and no focusin containment. PASS modal max-height/internal scrolling (styles.css:1366-1367), Settings fixed header/footer with scrolling page (2462-2468). Outside keyboard/programmatic focus escape and assistive-technology background access need runtime reproduction. Theme/resize/text/DPI, nested select trap behavior, scroll bleed NOT VERIFIED.
- Closing: PASS Escape/backdrop/close (Dialog.tsx:34-36,65-66,81). FAIL folder edits are discarded by any of these paths without dirty-draft policy (App.tsx:1473,1507-1509); changing settings is immediate save so no unsaved Settings confirmation is needed. FAIL focus restoration can lose owner when a menu action opens a dialog and the captured previous button is removed (Dialog.tsx:27,58-59 + App.tsx:548-551/561-564; App passes no returnFocus). PASS restoration when owner remains connected. FAIL exit retention absent (App.tsx:1456). Blur dismissal N/A modal policy.
- Semantics: PASS title/role/modal label. App replaces Settings with Shortcuts in-place (App.tsx:1487), while Dialog effect runs only once (Dialog.tsx:61), so source shows no initial-focus rerun for replacement; resulting focus runtime NOT VERIFIED.

### Remaining profiles, full A-0 applicability

SEARCH: PASS obvious labeled input, Ctrl K focus handler, empty-state text; no floating surface so anchoring/collision/exit/trigger ARIA N/A. FAIL brief result arrow/Enter/Ctrl+Enter paths and Esc-clears-query absent (App.tsx:901-909,387-392,971-974). No grouped commands/recent results/match marks/suggestions; enhancement gaps, not AA violations. No debounce/loading required merely for synchronous local filtering. Live result count and Narrator behavior NOT VERIFIED.

TOOLTIP: native title only; source FAIL keyboard-focus tooltip presentation/aria-describedby pattern requested by A-0/A-1. Some icons have only aria-label without title: folder plus/options (App.tsx:1011/1019), window controls (838/844/851), Close dialog (Dialog.tsx:80). Accessible-name PASS is separate from tooltip gap. Native delay/escape/collision/adjacent timing NOT VERIFIED; opening/while/closing cannot be controlled by app.

TOAST: PASS role=status (implicit polite live region). FAIL fixed 3s for success and errors, no hover/focus pause, no undo/retry action, newest string replaces previous (App.tsx:191-194,1449-1453). Check icon always used, including export/close errors (487,341-343), source misleading feedback. Focus trapping/anchor/menu keys N/A; overlays/announcements NOT VERIFIED.

COLLAPSE: PASS named folder button with aria-expanded (990-1007), native Enter/Space; FAIL state reset to hardcoded work/data on reload (83-85); FAIL tree Left/Right/Home/End behavior absent; plain button/folder group pattern means lack of tree role is not by itself AA failure. FAIL abrupt child mount/unmount (1082). Drag auto-expand NOT VERIFIED by this agent. Anchoring/escape/outside/blur N/A; screen-reader result and editor preservation NOT VERIFIED.

RENAME: folder submit Enter (form), Escape closes modal, maxLength=80 (1495-1520); FAIL no select-all or field initial focus, no duplicate-name feedback (submitFolder only trim/nonempty,566-577). Duplicate folders may be intentional allowance: needs product decision, not AA. Note title changes save on every change, Enter suppressed, no Escape revert or max-length feedback (1162-1175); label PASS; requested confirm/cancel is a UX model preference. Surface anchoring/open-close N/A for always-visible title. Screen-reader/errors/IME/RTL NOT VERIFIED.

RESIZE: PASS source focusable labeled separator with value/bounds updates (PanelResize.tsx:38-55,160-163), grab offset/10px threshold/capture/RAF (80-99), keyboard arrows/Home/End/Shift (118-128), min/max constraint (26-36), persistence (58-62), doubleclick reset (130,139), Escape/blur/cancel/lost capture cleanup (107-157). PASS hover/press/focus CSS (styles.css:2057-2060). Momentum projection N/A: free-width drag has no snap targets. Pixels, 1:1 behavior, editor preservation, theme/size/DPI resizing, cancellation/keyboard and announcements remain NOT VERIFIED runtime. Menu-style opening/closing N/A.

HOVER: PASS focus-within reveal and hover:none override (styles.css:2388,2409,2499-2500). FAIL note title padding changes from 9px to 78px on hover/focus (2393-2395), changes line/truncation geometry instead of pre-reserving controls. Focus not clipped/hit testing/flicker at runtime NOT VERIFIED. Anchoring/Escape/close semantics N/A for row controls.

## Highest confidence distinct findings for parent synthesis

1. Major candidate: modal background not inert; add inert application siblings and robust focus containment, with focus restore per invocation (WCAG 2.4.3/2.1.1 only claim after reproduction).
2. Major candidate: dialog launched by disappearing action button has no stable returnFocus; provide owning ellipsis/new-folder button or logical next row (WCAG 2.4.3).
3. Minor: folder rename loses unsaved field on outside click; dirty policy or keep draft.
4. Minor: delete/folder dialog default focus is Close, not Cancel/input; supply initialFocus.
5. Minor: right-click note/board menu appears at ellipsis rather than cursor; pass point={clientX,clientY}; keep same actions.
6. Minor: action dialogs do not close on blur; register window blur cleanup.
7. Minor: no action/dialog exits; retain through short opacity exit without locking inputs.
8. Minor: toast errors use success check icon, expire at 3s, no pause/action (separate findings if exhaustive).
9. Minor: folder-open state never persists.
10. Minor: hover/focus changes title space by 69px; reserve action area permanently.
11. Minor: folder-removal confirmation does not name folder/count (App.tsx:1527-1528); include name and item count.
12. Minor: board permanent-delete dialog/toast still says note (App.tsx:1470,1569); use item kind.
13. Brief feature gaps: folder/blank-space context menus, search result keyboard shortcuts, undo for structural edits. Do not promote every missing wishlist feature to AA.
14. Brief heading expectation: note title is textarea without h1 (App.tsx:1162), no equivalent active document h1 here; assess document heading structure separately (WCAG 1.3.1, not mandatory h1 solely because brief demands it).

## Existing tests inspected; never presented as run evidence

menu-exclusivity.spec.ts:26/47/63 cover replacement, Escape/outside, draft preservation. permanent-delete.spec.ts:40/58/73/90/98/108/118/130 cover cancellation, state/drafts, dark/minimum. sidebar-resize.spec.ts:18/45/62/84 and reference-resize.spec.ts cover tracking/keyboard/persistence/cancellation/narrow geometry. ux-critique.spec.ts:37/61/83/103 cover Reference/search/layout/backup. Parent can choose focused existing tests; filenames/test assertions are coverage intent, not PASS.

## Captures needed for unresolved shell items

Run full keyboard walks in both themes × Small/Medium/Large at native minimum and 1280×720/1920×1080; select long fonts/folder/note names; open options at all viewport corners; shrink vertically and ArrowDown to offscreen options; move menus while scrolling/resizing/theme switching; trigger blur; rapid reversal. Capture modal focus outline from invocation through Tab/Shift+Tab/Escape, menu-to-delete Cancel, Settings-to-Shortcuts and nested font select. NVDA/Narrator announce all triggers/selected items/disabled states/statuses. Windows WebView2 at 100/125/150/200% plus browser 200% zoom, forced colors; pointer pen/touch hover-free controls. Record failed export/error toast while hovering, timing and replacing multiple errors; restore after reload to check disclosure/resize preference. No runtime claim above substitutes for these captures.
