# Retrieval design handoff — Scribly 1.3.13

## Overview

Phase 3 extends the incumbent notebook with Find/Replace, matching notebook excerpts and destination reveal, and Pinned/Recently opened shortcuts. This is an Operate-mode extension of the existing writing interface. The visual authority remains [the incumbent design description](../.21st/DESIGN.md), [its decision record](../.21st/design.json), the supplied [AGENTS.md](../AGENTS.md), and the implementation's semantic tokens. This handoff records the extension; it does not create or replace a global design system.

No root PRODUCT.md, root DESIGN.md, approved comp, QUALITY BAR card or five-block concept contract exists for this feature. Their absence is an existing project choice, not a reason to invent a visual world. The code-led implementation preserves the Windows controls, writing priority, live editor and existing board engine.

The independent [UI review](retrieval-ui-review.md) reports `disposition: ship` at its stated screenshot/code scope, with its sole listed placeholder-contrast fix resolved. This documenter read the incumbent files and feature sources and independently inspected all three final captures. Interaction execution and native release checks remain the builder's responsibility; screenshots do not prove those behaviors.

## Colors

Find reuses `--panel` for its solid container, `--line` for boundaries, `--bg` for fields and `--text` for labels, input text and placeholders. Both empty fields explicitly retain full-opacity themed placeholder text. Matches use `--active`; the current match adds the existing `--accent` outline. Notebook excerpt marks use `--active` and `--text`. Selected shortcut rows use the same selection tokens as adjacent navigation.

The source and captures agree with the incumbent pale blue/white light theme and warm charcoal/ivory/sand dark theme. The feature adds no palette. The review's reported placeholder contrast checks are approximately 6.96:1 in light and 12.97:1 in dark; those are builder/reviewer measurements, not a new measurement by this documenter. Sources: [styles.css](../src/styles.css), [UI review](retrieval-ui-review.md).

## Typography

Find controls and sidebar shortcuts inherit the Segoe UI/system stack. Feature sizes use the existing independent text preference: Find and shortcut rows (13px), section headings and empty guidance (12px), each multiplied by `--text-scale`. Match counts use tabular numerals to avoid shifting as numbers change. Existing note-font preferences and code monospace remain intact.

The retrieval arrows, close, pin, recent and disclosure symbols reuse regular Phosphor icons; board shortcut rows reuse the incumbent AnimatedIcon board symbol. No font, icon library or new animation dependency is introduced by this extension.

## Layout

Find lives inside the central writing panel, above its content, with a sticky top position and no full-screen overlay. Search/options/replacement rows wrap as needed. Inputs can shrink to an 80px minimum; the count reserves 70px. Control spacing follows `--element-scale`, retaining the existing element-size preference instead of scaling the document visually.

The app's existing workspace owns final panel geometry: default Sidebar (294px), Reference (345px), and panel gaps (10px), all scaled and adjusted by existing responsive rules. When Find is open at widths up to 1050px, `onFindOpen` closes the overlapping Reference panel while retaining its selected item. The note editor's Find effect also reapplies this rule on resize. The existing Reference button remains available to reopen it. The 850×600 light capture shows complete Find/Replace controls and a readable document; the 1440×920 dark capture retains the three-panel hierarchy.

Pinned and Recently opened are compact shortcut groups above the existing folder navigation. Pinned starts expanded with useful empty guidance; Recently opened starts collapsed. Titles truncate within their rows. The board capture shows the same item in its Pinned shortcut and original folder, preserving the folder's role as its organizational home. Sources: [App.tsx](../src/App.tsx), [NoteEditor.tsx](../src/NoteEditor.tsx), [styles.css](../src/styles.css).

## Elevation & Depth

The added Find surface is solid with a quiet border. It has no scrim, additional shadow, backdrop blur or translucent reading layer. Excerpts and shortcuts remain part of existing sidebar material; board reveal uses the existing canvas selection and compact status area. Incumbent panel shadows, window corners and native scrolling remain authoritative. The feature introduces no reduced-transparency dependency.

## Shapes

New geometry is smaller than the surrounding panels: Find container (9px), fields/buttons (6px), shortcut rows (8px), each following `--element-scale`. These values extend the adjacent compact control geometry, including the formatting toolbar's 6px controls. Existing panels/topbar retain their actual 25px radius, and the native shell retains its 32px windowed/0px maximized rule. No feature styling changes those outer silhouettes.

## Components

### Find and Replace

Find opens from Ctrl+F or existing note/formatting options; Ctrl+H reveals replacement controls. Labeled fields, match status, previous/next buttons, Match case, Whole word and Close retain ordinary input/button semantics. Enter and Shift+Enter navigate; Escape restores the original editing position and scroll position. `NoteFind.tsx` maps its saved selection bookmark through transactions, retains the editor instance, clears presentation decorations on cleanup, guards read-only mutation and isolates replacement history. These are source observations; the detailed behavioral contract is in [retrieval-and-editing.md](retrieval-and-editing.md).

Highlights are ProseMirror decorations rather than saved HTML. Counting/navigation cover all matches, while painting is bounded to nearby matches in large notes. Original-file contents are explicitly excluded by an inline hint. Replace is absent for read-only notes and Reference remains read-only.

### Notebook excerpts and board reveal

Notebook search retains the existing search/navigation surface and adds a literal matching excerpt with a semantic highlight. Selecting a note result reveals its match through Find. A matching original filename reveals the source viewer, not a scan of original bytes. A board result reveals/selects its matching text or frame and displays a short causal status message.

`BoardEditor.tsx` uses `CaptureUpdateAction.NEVER` and `scrollToContent(..., { animate: false })` for reveal. This is a UI selection/viewport action rather than a drawing edit. Bound text selects its owning container. The board capture visibly shows the selected “Far needle label” and its matching status; it does not independently certify saved timestamp or Undo behavior.

### Pinned and Recently opened

Groups use disclosure buttons with `aria-expanded`; shortcut rows use ordinary buttons and `aria-current="page"` for the active item. Pin state also appears in the original item row and existing options menu. These are shortcuts, so they preserve existing folder order and native folder/note drag behavior. Stable item IDs back the groups. Persistence, Archive/Trash handling and the ten-item recent bound are documented in [retrieval-and-editing.md](retrieval-and-editing.md).

### Motion and response

The extension adds no spring, custom gesture, entry keyframe, exit delay or document-scale animation. Shared button press feedback remains immediate through the incumbent `button:active` transition override; activation remains normal click/keyboard behavior. Match navigation and board reveal are immediate. Sidebar disclosure changes its angle without adding a motion controller. Find's 100ms query debounce is search scheduling, not an animation or a promise of measured response time.

Existing workspace transitions remain the sole panel-layout owner. The global reduced-motion rules remove press translation, animations and transitions and use automatic scrolling. There is no new JavaScript spring requiring a separate preference listener. This scoped retrieval extension does not redesign screen-wide motion or custom dragging; the source/capture review makes no frame-latency claim.

## Do's and Don'ts

- Do preserve the solid writing surface, existing semantic theme tokens, independent element/text preferences and editor identity in follow-up work.
- Do keep Find highlights ephemeral, replacement reversible through Undo, read-only guards explicit and focus/scroll restoration independent of animation completion.
- Do retain destination feedback and the original folder location when navigating through shortcuts or board matches.
- Don't promote feature-specific Find geometry into replacement global panel tokens, add decorative material or rewrite incumbent design files during this handoff.
- Don't infer native WebView2 keyboard/focus behavior, installer installation, persistence success or performance from browser captures.

Actual evidence inspected:

| Capture | Size/state | Visible evidence |
| --- | --- | --- |
| [Narrow light](../.impeccable/review/phase3-narrow-light.png) | 850×600, light | Valid populated app; complete empty Find/Replace controls, readable placeholders, wrapping toolbar, Reference absent, shortcut headings/empty guidance present. |
| [Wide dark](../.impeccable/review/phase3-wide-dark.png) | 1440×920, dark | Valid populated app; same readable empty fields, warm incumbent theme, retained solid Reference, unchanged folder/navigation hierarchy. Save status is visibly “Saving…” rather than a certification of persistence. |
| [Board search](../.impeccable/review/phase3-board-search.png) | 1440×920, light | Valid populated app; matching text visibly selected on the board, causal match status, Pinned shortcut and original folder row, static read-only Reference. |

Pre-existing documentation drift is recorded without repair: the incumbent files still use the historical “Still Notes” name and their opening 12/24px radius summary, while current app branding is Scribly and actual panel geometry is 25px. The decision JSON's compact color summary only lists light colors; its narrative and DESIGN.md explicitly establish the warm dark theme. Earlier blanket CSS-transition language is supplemented by later incumbent entries for existing icon motion and startup springs. These are incumbent metadata differences, not retrieval changes. The review also records the detector's pre-existing blockquote accent border at `styles.css:1022` as out of scope; it was not changed by this handoff.

At the independent handoff, final production checks/native compilation were still in progress. Builder completion record: production browser checks passed (20 passed, four development-only skips); the optimized 1.3.13 Windows executable and NSIS installer built, and isolated WebView2 retrieval and protection workflows passed after correcting native recent-ID delta validation. The rebuilt frontend matched all 12,501 production-tested asset hashes. This documenter did not execute those tests; their evidence belongs to [verification](../tests/verification.md) and the [release audit](../release/build-1.3.13-20261004-165806/verification.json). The reviewer verdict remains limited to its listed resolved fix; the retained review matrix remains at its original evidence scope.

Only this handoff file was created. The incumbent design files, source, package/config and frozen build inputs were preserved.
