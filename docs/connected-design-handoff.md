# Phase 4 design handoff: connected notes and templates

Completed local extension: internal note/board links, derived backlinks and independent reusable note templates. This handoff documents the finished surfaces against `AGENTS.md`, `.21st/DESIGN.md` and `.21st/design.json`; those incumbent authorities remain unchanged. No approved comp, seed or product brief was supplied for this extension. The implementation continues the established Windows writing direction and three-panel hierarchy.

## Overview

The main document remains primary, navigation supports it, and Reference stays secondary. Connections use stable item IDs; labels retain their inserted text through later target renames. Collapsed Backlinks below the active item disclose incoming connections without adding persistent chrome. Templates are independent snapshots, with a read-only preview and a separate creation action. Source editing/deletion does not redefine the saved template or existing notes.

The bounded finish review in `docs/connected-ui-review.md` concludes **ship** after both original contrast findings were resolved. This documenter inspected source and the supplied captures, and did not run a browser, tests, build or native app. Review disposition is not proof of runtime or native persistence.

## Colors

Workflow fields, hints, result rows and previews reuse semantic `--text`, `--bg`, `--panel`, `--line`, `--active` and `--accent`. Light mode retains blue-gray chrome and blue selection/action accents; dark mode retains warm charcoal surfaces, ivory text and sand actions. The selected row uses `--active`; destructive template deletion uses the existing semantic danger treatment.

The finished light workflow subtitle uses `--text`. The scoped light primary background mixes the incumbent accent with black (12% default/focus, 18% hover), retaining the blue action character. The review reports subtitle contrast of 8.13:1 and white action text above 4.5:1 in both states, calculated from source colors. Dark actions keep their existing sand treatment. These corrections are scoped to workflow dialogs.

## Typography

Controls retain the Segoe UI/system stack. Field/checklist labels use the existing text scale (13px base); hints and result-type labels use 12px base. Preview prose uses the configured note typography with a 14px base. Strong result titles use restrained medium weight and can wrap anywhere. Authored formatting, images, ink and original-file references remain content rather than new chrome.

## Layout

`src/ItemLinkPicker.tsx` places search before a bounded result list, followed by Open/Open in Reference and Cancel/Insert link. Selection uses ordinary pressed-state buttons, and unavailable insertion actions stay disabled. Empty results explain restoration of Archive/Trash targets.

`src/TemplateDialog.tsx` shares Save/Manage/Choose modes. A chooser separates template selection, optional title, local-date substitution guidance, checklist reset, read-only preview and Create note. Management exposes an explicit permanent-delete confirmation, Keep template and a warning that folder defaults will be cleared while existing notes retain contents.

Workflow lists have native vertical scrolling (170px maximum); previews have native scrolling (220px maximum). The shared modal bounds its own scrolling by viewport height. Footer actions can wrap. The earlier workflow width declaration (620px maximum) is overridden by the later shared `.modal` width (470px times element scale); the captures show that effective shared geometry. This handoff records actual cascade behavior without changing it. The narrow deletion capture is intentionally scrolled to confirmation, so its offscreen heading is not a clipping finding.

## Elevation & Depth

Reading and preview surfaces stay solid. Dialogs reuse the incumbent dimmed, blurred backdrop, panel border and theme-aware dialog shadow; link options reuse solid `ActionPopover` without a scrim. No new glass layer or blur animation was introduced. The existing reduced-transparency rule removes backdrop blur and supplies a stronger solid dim layer.

## Shapes

Dialogs retain the shared scaled 23px radius and padding. Fields/actions use 6px corners; result-list and preview containers use 8px corners. These fit the incumbent smaller controls and rounded panels. The feature does not alter workspace gaps, panel widths, window radius or responsive panel ownership.

## Components

Links are underlined semantic-accent text with a visible 2px keyboard focus outline. Ordinary editable-text clicks preserve editing; Ctrl+click opens the target, Ctrl+Alt+click opens Reference, and Alt+click or focused Enter opens actions. Shared `ActionPopover` owns those actions; folder template defaults reuse `AppSelect`. Board links use existing canvas link controls and insertion Undo boundaries.

`NoteEditor` maps a selection bookmark through intervening transactions while the picker is open, restores it on cancel, and inserts the mark/title inside an isolated history boundary before returning editor focus. `Dialog` provides named modal semantics, initial input focus, Tab wrapping, Escape/outside dismissal and focus return. The picker explicitly returns to the editor/canvas. Template deletion confirmation uses `role="alert"`; fields have visible labels, result groups have accessible names, and selection uses `aria-pressed`. These are source-supported behaviors, not independently observed interaction passes.

The extension inherits immediate press feedback and shared 100ms opacity-only dialog/popover entry. Dismissal remains immediate; reduced motion removes transitions. No new spring, custom gesture, momentum rule, document scaling or editor-remount animation was added. Runtime focus restoration, rapid interaction and motion responsiveness cannot be scored from these stills.

## Do's and Don'ts

- Do keep stable IDs, mapped editor selection, independent snapshots and explicit template deletion/default cleanup.
- Do keep content solid, native scrolling, shared primitives and incumbent motion preferences.
- Do distinguish capture/source evidence from runtime and native validation.
- Don't promote this local extension into a replacement visual system or update incumbent authority files implicitly.

## Evidence and limitations

Inspected captures:

| Capture | Size | Evidence |
| --- | --- | --- |
| `.impeccable/review/phase4-links-narrow-light.png` | 850×600 | Selected Project reference, corrected enabled blue Insert link, readable supporting copy. |
| `.impeccable/review/phase4-template-wide-dark.png` | 1440×920 | Sand focus/action treatment, separated fields and solid bounded content preview. |
| `.impeccable/review/phase4-template-delete-narrow-dark.png` | 850×600 | Intentionally scrolled confirmation, legible warning and Keep/Delete actions. |

Implementation references: `src/ItemLinkPicker.tsx`, `src/TemplateDialog.tsx`, `src/ItemLink.ts`, scoped link/backlink handlers in `src/App.tsx`, `src/NoteEditor.tsx` and `src/BoardEditor.tsx`, and workflow CSS beginning at `src/styles.css:878`. Functional contracts, compatibility and test locations are in `docs/connected-notes-and-templates.md`; bounded finish findings and externally supplied test evidence are in `docs/connected-ui-review.md`.

[NEEDS INPUT] Independent runtime verification of focus/selection, System theme, maximized geometry and native WebView2 behavior remains outside this documenter pass. Native picker interaction, system-browser launch and installer installation are explicitly outside the documented automated coverage. Capacity profiling remains CAP-01/03; no unlimited-performance claim follows from this phase.

Pre-existing documentation drift is preserved: the opening incumbent design paragraph summarizes 12/24px radii and 160–220ms transitions, while subsequent incumbent guidance and source use scaled 23px dialogs, 25px panels and shared 100ms opacity entry. The review also identifies an existing `.source-file-text` accent-border detector warning outside Phase 4. Neither was repaired or reclassified as a feature blocker.

Both incumbent files have no Git diff and their SHA-256 hashes were identical before and after this documentation pass:

- `.21st/DESIGN.md`: `EC8B93227AB319E58A2F27504638774F81F7F64D808D656E3D6B4D891F627DE8`
- `.21st/design.json`: `1B778394EF27BAD475662423C021DFFDE0C84F0D8C85ECC8B909B07FAD7573DC`

Only `docs/connected-design-handoff.md` was written by this documenter. Root `DESIGN.md`, `PRODUCT.md`, sidecars and application source were not created or modified.
