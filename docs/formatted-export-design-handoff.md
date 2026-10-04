# Formatted export design handoff — Phase 5

## Overview

This is a code-led local extension of Notify/Scribly's established Operate interface: a protected export task with a frozen current-draft preview, visible format differences and three explicit output choices. It adds no visual identity, system redesign, dependency or motion redesign. Writing remains primary; export preparation and output occur independently of the live editor and autosave.

Authority compared: `AGENTS.md`, incumbent `.21st/DESIGN.md` and `.21st/design.json`, `src/ExportDialog.tsx`, `src/Dialog.tsx`, export integration in `src/App.tsx`, modal/workflow/export rules in `src/styles.css`, `src/formattedExport.ts`, `src/printNoteExport.ts`, `docs/formatted-note-export.md` and `docs/formatted-export-ui-review.md`. The impeccable document reference informed this scoped handoff. Root `PRODUCT.md` and `DESIGN.md` are absent; this extension does not create either, generate a sidecar, invent a creative world or reconcile historical context drift. Existing `.21st` context remains unchanged.

## Colors

Application chrome inherits `--panel`, `--text`, `--line`, `--accent` and `--danger`; the dialog introduces no app palette. Light mode keeps blue-gray chrome and blue actions. Actual incumbent dark mode uses warm charcoal, ivory text and sand actions, as recorded in `.21st` context and the supplied dark capture. Preserve this distinction rather than substituting a blue dark theme from older guidance.

The preview and standalone HTML deliberately share a fixed light reading document in both app themes: white background, `#202b3d` text, `#1960a8` links, `#d8dfe8` borders and `#f0f3f7` code/source/disclosure surfaces. Export colors are output styling, not replacement application tokens. Validated semantic foreground/background marks use the nine light palette pairs in `formattedExport.ts`; arbitrary authored CSS is not retained.

## Typography

Dialog controls continue system/Segoe typography and existing text scaling. Warnings use `12px * --text-scale`, 1.5 line height; errors use scaled 13px and wrap long text. Output prose uses 16px/1.65 Segoe UI/system sans serif, headings use 1.25 line height, and code uses Consolas/monospace. Do not add a display face or scale the live document to imitate layout changes.

## Layout

The export uses shared `Dialog` with `workflow-dialog export-dialog`. Its width is `min(780px, calc(100vw - 40px))`. Ordering is heading/close, scope/count/snapshot timing, format explanation, prepared format warnings, preview, error/status/retry and output actions. Disclosures precede every export action.

`.export-preview` is a separately scrollable iframe, full width with `clamp(180px, 32vh, 320px)` height and 16px vertical margins. The action row wraps through existing workflow rules and uses an 8px gap. Output content has an 850px maximum reading width, 40px vertical outer margin and 32px horizontal padding; print removes that container margin/padding and uses 18mm page margins. Batch print notes start on new pages; long code wraps and raster images retain proportions.

At 850×600 the supplied light capture shows the complete dialog, losses and action row with a smaller preview viewport. Reference was hidden through its existing toggle to avoid a separate incumbent shell overlap. This is evidence setup, not an export fix or a promise that the underlying shell works with both supporting panels at that width. The 1440×920 dark capture retains the same task hierarchy and white preview.

## Elevation & Depth

Reuse the solid themed modal, established tinted/blurred modal backdrop, line border and `--dialog-shadow`. The inherited light shadow is `0 24px 80px #091b4344`; dark uses `0 24px 80px #00000070`. The reading preview is solid white, without glass behind text. Existing reduced-transparency fallback remains authoritative; no new material or animated full-screen blur is introduced.

## Shapes

Keep shared modal geometry, including its existing `23px * --element-scale` radius, scaled 27px padding and neighboring control shapes. The preview has an 8px radius and 1px theme border; Retry has a 6px radius. Export code uses an 8px radius. These values describe the implementation and do not establish a new app-wide radius scale.

## Components

### Protected export dialog

`openFormattedExport` checkpoints current editor/title changes, shallow-copies note items and closes the owning action surface. Preparation synchronously captures primitive title/content values before asynchronous work. Reopening captures a newer draft. Single-note and folder entry points retain existing menu ownership; folder export includes live ordinary notes and excludes boards, templates, archived and deleted items.

Shared `Dialog` supplies modal labeling, initial focus, keyboard trap, Escape, outside-backdrop dismissal and return to the recorded owner when connected. Closing aborts preparation. These are inspected source behaviors; screenshots do not independently prove focus/selection restoration. Preserve the active editor instance, selection, scroll and save/error reporting, and never tie data changes to animation completion.

### Preview, warnings and actions

The preview uses `sandbox=""` with sanitized standalone HTML. Preparation completes both artifacts before enabling output. Cancel and close remain available during preparation; format actions disable only while output is unavailable or an operation is busy. Visible states include Preparing export, per-format progress, preparation Retry, persistent errors and save cancellation.

Actions are Cancel, Save HTML, Print / Save as PDF and primary Export Markdown (.zip). Markdown is a ZIP with Windows-safe unique filenames, deduplicated raster sidecars and README. HTML embeds raster assets. Internal IDs remain visible; in-batch HTML anchors and Markdown filenames connect exported notes. Out-of-batch references retain identifying text/IDs rather than promising notebook access.

Keep conditional format disclosures explicit: handwritten ink/freehand highlights are omitted from every formatted output; HTML/print preserve semantic colors in the light palette while Markdown loses colors, underline and exact layout; original-file blocks contain filename, size and encoding, without original contents. Notebook backup/download-original workflows retain their separate purpose.

### Print handoff and recovery

`printNoteExport.ts` creates a separate offscreen document, strips executable/navigation surfaces, waits for fonts/images and requests printing. The source survives until `afterprint`; abort/error cleans it up. Printing reports a dialog request, never confirmed PDF/paper saving. Save HTML and browser printing is the explicit fallback. Browser file success means download initiation; desktop success follows storage's confirmed save result.

### Motion and limits

Shared final modal/backdrop rules remove legacy keyframes and use 100ms opacity-only entry, instant dismissal and no transition under reduced motion. Export adds no spring, gesture, bounce, layout animation or velocity handoff. Existing immediate button semantics remain shared. Motion smoothness and live preference changes are not established by still captures.

Preparation has independent working limits: 1,000 notes, 12×1024×1024 content characters per note, 24 MiB estimated title/content string input, 32 MiB unique raster bytes and 96 MiB estimated working output. These are separate from overall notebook quota and are estimates rather than a measured peak-memory guarantee. Existing image validation remains 5 MiB/25 million pixels, with structural complexity limits. Errors direct users to smaller batches or repair unavailable images; no partial artifact is offered.

## Do's and Don'ts

- Do retain frozen-draft timing, visible losses, explicit format labels and truthful cancellation/print copy.
- Do retain shared Dialog semantics, solid themed chrome, light output and editor/autosave independence.
- Do preserve the supplied evidence and incumbent design/context artifacts.
- Don't imply ink/original contents are included or that Markdown matches HTML page/color fidelity.
- Don't introduce decorative movement, a new palette, app-wide context replacement or native success claims from browser evidence.

The bounded UI review is recorded in `docs/formatted-export-ui-review.md` with a ship disposition for the supplied export UI/sample scope. Evidence inspected here: `.impeccable/review/phase5-export-narrow-light.png` (850×600), `.impeccable/review/phase5-export-wide-dark.png` (1440×920), and `release/phase5-export-evidence/printable-page1.png`. The PDF page visibly retains Unicode, heading hierarchy, task states, literal code, caption and wrapped long code; its large white area is the intentionally white fixture image. It does not establish general large-image pagination.

This documentation pass ran no build, tests, browser automation, detector or packaging. Version 1.3.15 packaging/native checking was pending at handoff; no release pass is claimed. Native Windows Save/Print, measured contrast, complete Unicode coverage, large-image pagination and sustained memory behavior remain unverified. The existing bounded review is not a whole-app native audit.

Release follow-up: the primary agent subsequently completed Windows 1.3.15 packaging and isolated WebView2 verification, including actual HTML Save with matching bytes and native print preview/cancellation. ZIP Save and native PDF saving remain unexercised. This later evidence does not expand the independent UI review's scope. [Final verification](../tests/verification.md), [release audit](../release/build-1.3.15-20261004-190839/verification.json).
