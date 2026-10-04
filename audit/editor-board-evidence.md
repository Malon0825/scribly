# Editor and board audit evidence

Source inspection only, 2026-10-04. No browser, tests, native WebView, screen reader or measurements were performed by this agent. PASS below means a directly inspectable implementation provision, not a verified runtime experience. All themes, Small/Medium/Large, minimum geometry, display scaling, latency, visual contrast, announcements and rapid interruption remain NOT VERIFIED unless the parent supplies runtime evidence. Read AGENTS.md and the supplied audit brief. The 21st-ui-review skill was read; `.21st/design.json` and a `21st` command were unavailable, so its deterministic CLI review was NOT VERIFIED.

## Interactive inventory

| Surface / controls | Source |
| --- | --- |
| Note editor editable textbox; Reference textbox; native selection/context menu | `src/NoteEditor.tsx:89-111`, `197-203` |
| Undo, Redo, Text style (Text / H1 / H2 / H3), Bold, Italic, Code block, Bullet list, Checklist, Add images, Text/background color | `src/NoteEditor.tsx:223-289` |
| Highlight primary + separate options chevron; Draw primary + separate options chevron; active Guided/Free mode switch | `src/HighlighterTools.tsx:51-72` |
| Highlighter/Draw options: Guided, Free, Auto assist (Draw), stroke Small/Medium/Large, color swatches, Highlight selected text, Clear marker/drawing strokes | `src/HighlighterTools.tsx:73-112` |
| Drawing surface, Return to writing, wheel-mode change, Escape, drawing Undo via document history | `src/NoteEditor.tsx:186-201`, `src/InkLayer.tsx:72-150` |
| Selection-color surface: compact text/background swatches, Default text/background, More/Fewer colors | `src/SelectionColors.tsx:73-91` |
| Hidden image file picker, image-paste path, async insertion status and Dismiss | `src/NoteEditor.tsx:91-104`, `120-157`, `190-194` |
| Image select/double-click; drag handle; View image; Image options; two keyboard/pointer resize handles; editable caption | `src/ImageBlockView.tsx:108-128` |
| Image actions: View full size, Download, Edit caption, Align left/center/right, Full width, Move up/down, Remove | `src/ImageBlockView.tsx:131-144` |
| Image-preview dialog: Actual size, Download, Close, backdrop dismissal, scrollable image | `src/ImageBlockView.tsx:12-41` |
| Code language select, Wrap, Copy and copy status | `src/CodeBlockView.tsx:31-48` |
| Board Insert and Export chevrons; Architecture disclosure; role segment, Boundary select, Snap toggle | `src/BoardEditor.tsx:271-289` |
| Insert actions: Brand logos, Templates, Import Mermaid, Shape library | `src/BoardEditor.tsx:303-308` |
| Export actions: Drawing, SVG, PNG, Mermaid, Copy for Miro | `src/BoardEditor.tsx:309-315` |
| Excalidraw toolbar/style, overflow tools, library/help, canvas and context menu owned by engine | `src/BoardEditor.tsx:291-300`; engine patch/behavior needs separate inspection/runtime |
| Board feedback/error Dismiss | `src/BoardEditor.tsx:318` |
| Export flowchart dialog: Direction, Show shape, reviewed-draft checkbox, preview, selectable code, Close, Download Mermaid, Copy code | `src/BoardEditor.tsx:319-343` |
| Brand modal: search, category, Popular/Recent/All brands, Cloud/Databases/Messaging chips, virtualized grid, variant, dark background, add/remove selection, queue remove/clear, Retry catalog, Done/Stop and close, Insert | `src/BrandLogoPicker.tsx:86-134` |

## A-0 behavior matrix for editor/board surfaces

The full shared contracts below apply to every named consumer, so no cell is silently treated as passing through inheritance.

### Shared ActionPopover contract

Consumers: Highlight options, Draw options, Selection colors, Image actions, Board Insert, Board Export.

| A-0 check | Status and exact evidence |
| --- | --- |
| Obvious trigger / 24px hit area | Named button/chevron PASS source for Highlight/Draw/Image/Board; selected text uses native context trigger and disabled named palette button. Rendered hit sizes NOT VERIFIED (`styles.css:825-829`, `2423`). |
| 100–200ms opening without flash/layout jump | NOT VERIFIED. CSS opacity entry is 100ms (`styles.css:2183`, `2274`); no timing measurement. |
| Anchor correct | PASS source: anchor rect or explicit pointer point, above/below side (`ActionPopover.tsx:14-22`). Actual placement NOT VERIFIED. |
| Collision/portal | PASS source: 10px clamps, max viewport bounds, body portal (`ActionPopover.tsx:16-22`, `66`). Small-window clipping NOT VERIFIED. |
| Layering | NOT VERIFIED: action z60 versus select z150 and preview z180 (`styles.css:2186`, `2221`, `2342`). |
| Initial focus | PASS source: first enabled button focus (`ActionPopover.tsx:42`). |
| Up/Down/Home/End | PASS source handler (`ActionPopover.tsx:56-63`); no automatic focused-item scroll and no Left/Right swatch-grid navigation: FAIL for palette grid expectations. |
| Enter/Space activation | PASS source native buttons. Typeahead/submenu navigation N/A for these compact action dialogs; grid spatial navigation fails above. |
| Tab policy | PASS source: closes, focuses anchor then permits default Tab (`ActionPopover.tsx:54`); resulting destination NOT VERIFIED. |
| Hover/focus vs selected | PASS source selectors (`styles.css:183-185`, `201`, `2227`, `2252`); contrast NOT VERIFIED. |
| Disabled skip / visible / reason | Skip PASS source (`ActionPopover.tsx:56`), opacity PASS source (`styles.css:191-194`). Reasons FAIL for disabled Highlight selected text (`HighlighterTools.tsx:94`) and Copy for Miro (`BoardEditor.tsx:314`) without descriptive tooltip. |
| Internal scroll / no bleed | Internal scroll PASS source (`styles.css:2224`); no action-popover overscroll containment declared, runtime bleed NOT VERIFIED. |
| Resize/DPI/text/theme while open | Resize/anchor/content ResizeObserver PASS source (`ActionPopover.tsx:29-31`); themes use tokens. Runtime NOT VERIFIED. |
| Only one owner | PASS source custom action-open event closes other action owners (`ActionPopover.tsx:25-28`); App/engine/select exclusivity NOT VERIFIED. |
| Preserve editor selection/caret | Selection range captured and restored during apply PASS source (`SelectionColors.tsx:24-30`, `59-70`); other focus paths NOT VERIFIED. |
| Escape/outside/scroll | PASS source (`ActionPopover.tsx:32-41`, `53`). Selection colors also close on selection/edit change (`SelectionColors.tsx:52-57`). |
| Trigger re-click | PASS source Highlight/Draw/Image/Board toggle handlers. Selection palette toolbar trigger always reopens current selection rather than toggling (`NoteEditor.tsx:46`, `SelectionColors.tsx:23-31`): FAIL strict re-click policy. |
| Selecting item closes | PASS source image/board/color actions; mode/color/size choices intentionally keep tool-options open (multi-configuration exception). |
| Window blur | FAIL source: ActionPopover registers no blur listener (`ActionPopover.tsx:29-47`). Ink gesture's blur cancellation is separate. |
| 80–150ms exit | FAIL source: consumers return null/unmount immediately; opacity transition does not retain exiting DOM (`SelectionColors.tsx:72`, `HighlighterTools.tsx:73`, `ImageBlockView.tsx:144`, `BoardEditor.tsx:316`). |
| Focus return | PASS provision on Escape/Tab/cleanup (`ActionPopover.tsx:47`, `53-54`); selected-color anchor is editor DOM, logical return. Runtime NOT VERIFIED. |
| Rapid reversal/orphans | NOT VERIFIED. Shared close owner is implemented; no observed rapid-click evidence. |
| Roles/ARIA | PASS source labeled nonmodal `role=dialog` (`ActionPopover.tsx:50`), expanded/haspopup on tool/image/board triggers. Toolbar colors lacks expanded/haspopup/controls: FAIL (`NoteEditor.tsx:287-288`). |
| Actual screen-reader open/count/selection | NOT VERIFIED; do not infer from labels. |

### Shared AppSelect contract

Consumers: Text style, Code language, Architecture boundary, Diagram direction, Logo category, Logo variant. They all use Radix Root/Trigger/Portal/Content with 6px offset and 10px collision padding, item textValue/typeahead, selected indicators and scroll buttons (`src/AppSelect.tsx:14-34`). This is a PASS implementation provision for consistent custom selects, accessible label, portal placement and chosen-item indicator. Keyboard navigation/typeahead, focus restoration, selected scroll-into-view, blur policy, simultaneous surfaces, runtime collision, clipping, and actual announcements are NOT VERIFIED by source inspection alone. `onCloseFocus` expressly restores writing focus only on Text style (`NoteEditor.tsx:242`). Long selected labels truncate in CSS without a title on AppSelect Trigger (`styles.css:2170`, `AppSelect.tsx:15-16`): FAIL the requested tooltip for truncated labels. CSS opening opacity is 100ms; conditional Radix exit behavior NOT VERIFIED rather than assumed.

### Modal/virtualized/engine contracts

| Surface | Opening | While open | Closing | Semantics |
| --- | --- | --- | --- | --- |
| Brand logos | PASS source named Insert action and return focus; async opening status (`BoardEditor.tsx:305,317`, `BrandLogoPicker.tsx:97`). Focus moves to Dialog first button (Close), not search; search autofocus is NOT VERIFIED and not explicitly implemented. | PASS source search/category/chips, virtualized rows, arrow/Home/End and scroll-to-item, loading/retry, busy-disabled mutations, multi-insert queue (`BrandLogoPicker.tsx:26-39,58-84,100-134`). FAIL live result-count announcement (plain p at 99). FAIL preserved scroll on reopen (fresh state at 32 and no persisted restoration). Modal background inert FAIL source (Dialog has only Tab boundary wrap). | PASS source Escape/backdrop/Done and return trigger through Dialog; insertion AbortController cleanup (`40`). Exit retention FAIL. Blur dismissal NOT VERIFIED/policy absent. Partial completed insertion error report PASS (`83`). | PASS source labeled dialog (`Dialog.tsx:72-77`) and listbox active descendant/option position (`BrandLogoPicker.tsx:100,111`). Actual SR announced result/queue count NOT VERIFIED. |
| Export flowchart | PASS source initial focus chooses copy or selected fallback code (`BoardEditor.tsx:319-321`, `189-193`). | PASS source omitted-connection review gates, selectable code, local-preview failure label and overflow body (`328-341`, `board.css:172-175`). Copy busy prevents duplicate clipboard operation (`174-187`). FAIL SVG/PNG/drawing generation busy/progress provision (see finding EB-08). Direction/theme preview cancellation provided (`194-205`). | PASS source Escape/backdrop/Dialog return, late copy attempt invalidation (`173`). No unmount exit retention: FAIL. | PASS dialog/code labels/status/error source; actual announcements NOT VERIFIED. |
| Image preview | PASS source first button focus and portal (`ImageBlockView.tsx:17-19,41`), but initial button is Actual image size. | PASS source Tab wrap and image scroll (`22-26,39`). FAIL background inert/focus ownership: none in custom preview. Busy/duplicate download guard absent. Geometry/high contrast runtime NOT VERIFIED. | PASS source Escape/backdrop/Close/previous focus restoration (`21,29,31,36`). FAIL retained exit and blur policy. | PASS named modal dialog (`32`), image alt; actual SR NOT VERIFIED. |
| Excalidraw toolbar/style/library/help/context menu | Theme and UI options configured (`BoardEditor.tsx:296-300`). All rendered hit targets, trigger roles, collision, overlay positioning and timing NOT VERIFIED without engine source/runtime. | Context menu arrow/Home/End, scrollIntoView and Enter/Space propagation handler PASS source (`73-100`). Theme tokens cover engine portals (`board.css:49-99`), drawing unchanged; actual light/dark parity NOT VERIFIED. | Context menu Escape/Tab clears scene menu and restores canvas focus PASS source (`83-90`); other engine close paths NOT VERIFIED. | Engine SR/keyboard shortcut conflicts NOT VERIFIED; global keys disabled (`296`) is evidence only. |
| Native editor/Reference context menu | N/A custom handler in Reference (`NoteEditor.tsx:203` limits SelectionColors editable only). Empty/code selection does not suppress native menu (`SelectionColors.tsx:10-17,39`). Native WebView contents are NOT VERIFIED. | Ordinary selected text suppresses native menu and colors-only replacement: FAIL clipboard/context parity. Links, code blocks and images have no app right-click actions in these files; native contents NOT VERIFIED. | Native policy NOT VERIFIED. | Native screen reader NOT VERIFIED. |
| Color palette extra features | Current choice checks + pressed and expanded choices PASS source (`SelectionColors.tsx:73-91`). | Custom color, recents and live preview absent: FAIL requested feature checks, lower-priority product gaps. Semantic color tokens provided (`styles.css:2230-2247`); contrast runtime NOT VERIFIED despite existing test. | Apply restores selection/focus PASS source (`59-70`). | Palette grid uses groups/buttons, no Left/Right: FAIL spatial keyboard expectation, not core keyboard inaccessibility because Tab/vertical keys exist. |

## Proven distinct findings for parent consolidation

**[EB-01] Major — Selected-text colors replace clipboard context actions**
- **Where:** Editable note, ordinary non-code text selection, all themes/sizes.
- **Trigger/State:** Right-click a selected word or press Shift+F10.
- **Observed:** `SelectionColors.tsx:37-44` prevents native contextmenu when colorable, while rendered surface `73-91` contains only text/background color controls. No Cut/Copy/Paste or spell-check path remains in that custom surface.
- **Expected:** A-1.4 preserve text editing context actions while supplying formatting; direct clipboard access remains discoverable.
- **Fix:** Keep native menu on editor context click; offer colors through named palette button, or create a deliberate selected-text action surface with clipboard actions and a documented spell-check-preserving path.
- **Effort:** M.

**[EB-02] Major — Modal backgrounds are never made inert**
- **Where:** Brand logos, Export flowchart, Image preview; shared Dialog affects other screens too.
- **Trigger/State:** Dialog open; assistive/programmatic focus navigation to background.
- **Observed:** `Dialog.tsx:26-61` only wraps Tab at first/last control; `ImageBlockView.tsx:16-30` likewise. No background inert or focusin enforcement. `App.tsx:886,1379` inert conditions concern collapsed panels only.
- **Expected:** A-0 modal focus ownership and A-1.8 background inert; actual SR leakage is NOT VERIFIED.
- **Fix:** Centralize modal rendering/ownership, mark app siblings inert during the active modal, restore prior inert state, and use an established focus containment primitive with nested portal-aware behavior.
- **Effort:** M.

**[EB-03] Minor — Action popovers stay open after app blur**
- **Where:** Highlighter/Draw/colors/image/board Insert/Export action popovers.
- **Trigger/State:** Open surface, switch to another window.
- **Observed:** All listeners in `ActionPopover.tsx:29-47` omit window blur.
- **Expected:** A-0 requested blur dismissal.
- **Fix:** Add window blur close callback to shared owner and cleanup; validate pending palette selection remains intact.
- **Effort:** S.

**[EB-04] Minor — Expanded palettes have vertical-only navigation and do not scroll focused choices into view**
- **Where:** Selection colors and Highlight/Draw options.
- **Trigger/State:** ArrowRight/Left over a 3-column swatch grid; ArrowDown/Home/End in constrained popup.
- **Observed:** `ActionPopover.tsx:58-63` handles only vertical keys/Home/End, flattens all buttons, and focuses with preventScroll. Palette grid is explicit 3 columns (`styles.css:2250`).
- **Expected:** A-1.3 swatch grid keyboard navigation; A-0 internally scroll reachable commands.
- **Fix:** Dedicated roving 2D swatch-group handler; after keyboard navigation scroll focused item with block nearest. Keep section-to-section Tab policy.
- **Effort:** M.

**[EB-05] Minor — Logo search counts are not announced and reopen loses position**
- **Where:** Brand-logo virtualized catalog, all themes/sizes.
- **Trigger/State:** Search/filter result changes, close then reopen after scrolling.
- **Observed:** Count at `BrandLogoPicker.tsx:99` is plain p with no live region; `32` initializes top=0 and no scroll state storage exists. Virtual list keeps aria positions but resets browse state on remount.
- **Expected:** A-1.18 n-results live announcement and retained scroll on reopen.
- **Fix:** Debounced polite result-count status; retain query/category/view/selected brand/scroll offset in board owner or picker state store and restore after catalog sizing.
- **Effort:** M.

**[EB-06] Minor — Caption Escape commits instead of canceling**
- **Where:** Image caption edit.
- **Trigger/State:** Edit caption then Escape.
- **Observed:** `ImageBlockView.tsx:126` persists every change via updateAttributes; `127` treats Enter and Escape identically, closes and focuses editor without restoring original caption.
- **Expected:** A-1.13 Enter confirms / Escape cancels editable field.
- **Fix:** Capture initial caption, edit local draft, commit on Enter/explicit blur policy, restore draft on Escape; preserve Undo boundaries.
- **Effort:** S.

**[EB-07] Minor — Surfaces have opacity entry but no retained exit**
- **Where:** Action popovers and modal consumers.
- **Trigger/State:** Dismiss open menu/dialog.
- **Observed:** Conditional rendering unmounts immediately (`NoteEditor.tsx:203`, `SelectionColors.tsx:72`, `ImageBlockView.tsx:144-145`, `BoardEditor.tsx:316-343`). `styles.css:2183,2277-2279` offers 100ms entry opacity, not exit DOM retention.
- **Expected:** A-0/B requires short exit; AGENTS requires interruption without delaying semantic dismissal.
- **Fix:** Shared presence controller retains inert, noninteractive exiting surface for opacity-only 100ms, can reopen from live opacity, instant reduced-motion exit. Do not delay focus/state changes.
- **Effort:** M.

**[EB-08] Minor — Image exports provide neither in-flight state nor duplicate-submit guard**
- **Where:** Board Export SVG/PNG/Drawing.
- **Trigger/State:** Trigger an export and reopen/repeat while image generation/native save pending.
- **Observed:** `BoardEditor.tsx:206-211,249-256` awaits artifact generation/save but owns no exportBusy/progress; `311-312` launch asynchronously. copyBusy only applies Mermaid clipboard.
- **Expected:** A-1.16 progress for large work and C double-submit safety; >1s occurrence NOT VERIFIED.
- **Fix:** Single export-operation owner/busy ref and visible announced Generating/Saving status, disable duplicate export commands with reason, restore after cancellation/failure.
- **Effort:** S.

**[EB-09] Minor — Palette trigger does not expose its open state and cannot re-click-close**
- **Where:** Text/background color toolbar button.
- **Trigger/State:** Open via toolbar, click same trigger again.
- **Observed:** `NoteEditor.tsx:287-288` omits expanded/haspopup/controls; `46` invokes SelectionColors open, whose `23-31` always sets popup instead of toggling.
- **Expected:** A-0 trigger open semantics and trigger re-click dismissal.
- **Fix:** Lift palette open state/trigger ref or register a toggle callback; add aria-haspopup=dialog, aria-expanded and stable controls id.
- **Effort:** S.

**[EB-10] Minor — Long select values truncate without full-value tooltip**
- **Where:** All AppSelect consumers, especially code language, brand variant, architecture boundary.
- **Trigger/State:** Long selected label at narrow/large text.
- **Observed:** `styles.css:2170` ellipsizes Trigger span; `AppSelect.tsx:15-16` no title/custom tooltip with selected full label.
- **Expected:** A-1.1 full label discoverable on truncation.
- **Fix:** Tooltip on trigger for selected full value when measured overflow, including focus; preserve accessible field name and selected value.
- **Effort:** S.

## Missing surfaces and cautions

- Image options have button access and keyboard move/resize alternatives, but no custom image contextmenu or Shift+F10 mapping in ImageBlockView; parent can list this as A-1.4 parity gap after confirming native menu contents.
- Code block has language/wrap/copy actions rather than a custom context menu; native editing context menu is preserved by selection-color exclusions. Do not claim native menu is broken.
- Imported links are recognized with `link.openOnClick:false` and no link create/edit/follow/menu action appears in the inspected editor toolbar (`NoteEditor.tsx:73,223-289`). Keyboard/modifier/native follow behavior is NOT VERIFIED; parent should test before declaring links inaccessible. If no deliberate path exists, supply Ctrl+click/open-link contextual action and safe keyboard equivalent.
- Custom/recent text colors and live palette preview are absent. These are requested capability checks/product gaps, not proof of a WCAG failure.
- Tool settings remember per tool during current mount (`HighlighterTools.tsx:18-20`); cross-session last-use persistence is absent here. Product policy should decide persistence rather than infer a data loss issue.
- Text-style/code/logo/direction selects are consistently custom Radix selects, so do not flag native/custom inconsistency without runtime evidence.
- Brand artwork uses fixed checkerboard/white/dark colors intentionally as authored artwork canvas; do not equate fixed artwork colors with theme-token chrome defect (`board.css:32-37`, `brand-logo-picker.css:16-17`).

## Motion/material evidence

| Element | Declared current behavior | Source verdict |
| --- | --- | --- |
| Button press | Immediate transition-duration 0s and 1px translate; return base 160ms | PASS source immediate feedback; runtime latency NOT VERIFIED (`styles.css:180-189`). |
| Action/select opening | opacity 100ms, animation:none, starting opacity0 | PASS restrained entry; exit FAIL / Radix exit NOT VERIFIED (`2174-2183,2274-2275`). |
| Dialog/backdrop | opacity100ms, animation:none; reduced-motion none | PASS source reduced motion; runtime interruption/exit NOT VERIFIED or conditional unmount FAIL (`2277-2279`). |
| Engine context menu | opacity100ms, colors100ms; no keyframe, reduced-motion transition none | PASS source (`board.css:124-165`); engine opening/closing runtime NOT VERIFIED. |
| Engine Help modal | instant animation:none/opacity1 | Deliberately instant, including reduced-motion safety (`board.css:106-110`); runtime NOT VERIFIED. |
| Image resize | direct pointer width updates, capture, cancel/blur/resize/Escape; commit only release | PASS source reversible manipulation and keyboard alternative (`ImageBlockView.tsx:60-95,118-124`); gesture smoothness NOT VERIFIED. |
| Logo virtual scroll | fixed ROW_HEIGHT120 / 112px row plus8px gap | PASS source stable virtual geometry (`BrandLogoPicker.tsx:12,58-61`, `brand-logo-picker.css:12-13`); actual density/zoom NOT VERIFIED. |

Surfaces remain solid semantic panel/chrome; floating/action and dialog shadows use tokens (`styles.css:2175-2179,2343-2344`, `board.css:49-99`). Palette/checklist colors and UI contrast require runtime measurements. Type drift candidates: Highlighter mode/helper and code hint declare 11px (`styles.css:860,863,2142`), violating brief's preferred minimum12 secondary text; actual scaled size depends text setting, so parent should report base-setting provision and measure. Logo picker geometry and count at fixed12px are not scaled with app text unlike board Dialog font (`brand-logo-picker.css:8,15,20-21`), a text-size consistency risk needing runtime verification.

## Existing test evidence (not run)

Available suites meaningfully cover these paths: `tests/selection-colors.spec.ts` (context colors, keyboard, persistence, native empty/code exceptions, bounded reduced-motion, 4.5 contrast test); `image-blocks.spec.ts` (paste/drop/resize cancel/keyboard/actions/Undo/invalid and full workspace); `highlighter-pen.spec.ts`, `drawing-pen.spec.ts` (cancellation, wheel, per-tool settings, assistance/Undo/read-only); `brand-logos.spec.ts` (offline catalog, failure/cancel, reversible logo insert, capacity); `board-context-menu.spec.ts` (key navigation/Tab/Escape/large-text); `board-design.spec.ts` (themes, layout survival, help reduced motion); `board-export-flow.spec.ts` (review, clipboard fallback, close during pending work, errors, minimum size); `board-extensions.spec.ts` (Mermaid validation/import/preview/cancel/read-only). Test presence is not a passing result. Parent should use existing behavioral checks and add targeted runtime reproduction for EB-01/03/04/05/06/08/09 instead of copying constants.

## Native / assistive / performance captures still required

Tauri WebView2 right-click clipboard/spell-check, image native download/save, canceled exports, Narrator/NVDA modal/listbox announcements, high contrast, 200% zoom, all Windows scaling factors, actual open latency, full logo scrolling, keyboard focused-item scrolling, native menu content and link-follow modifier paths remain NOT VERIFIED. Capture a screen recording with keyboard focus visible for palette arrow/scroll, image caption Escape, blur dismissal and rapid menu reopen; inspect accessibility tree plus Narrator for count announcements and modal background traversal. Preserve authored note/board data when seeding large workloads.
