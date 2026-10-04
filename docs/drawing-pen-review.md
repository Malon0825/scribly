# Note Draw tool

## A. Feel audit

The new tool reuses the verified note highlighter controller: direct captured pointer tracking and next-frame SVG preview, cancellable drafts, one Undo/save transaction on release. Browser feature checks verify free/guided strokes, cancellation, switching, persistence, imports and Reference. Springs are N/A for painting. Native appearance and hardware-pen latency remain unmeasured.

## B. Interaction

Choose Draw beside Highlight; Free follows the hand. Drawing options offer Guided straight lines at any angle, Free and three colors. Wheel during a stroke switches modes, retaining the raw path for reversal. Escape cancels and returns to writing. Keep independent mode/color settings per tool during the editor session; selecting one deactivates the other. Clear drawing strokes leaves markers intact and supports Undo. Short taps and existing blur/capture/scroll/resize/document cancellations leave no saved stroke. Keyboard users can activate/configure the tool and clear/Undo strokes; path creation requires pointing input.

## C. Motion spec

Reuse the ref-owned SVG/rAF controller, captured pointer, 10px recognition threshold and bounded 512-point sampling. Draw paths are 3px times text scale with opacity 1, rounded caps and joins; markers retain 16px and opacity .35. No springs, momentum, rubber-banding, keyframes or delayed completion. Reduced motion retains direct tracking and instant commits/cancellation. Store an optional validated draw kind; absent kind remains a legacy marker. Coordinates remain geometric block anchors, so editing/wrapping text can shift alignment with words.

## D. Materials

Reuse solid toolbar/ActionPopover, theme border/shadow, existing Phosphor icons and no scrim. Default pen uses foreground, Accent uses the theme accent, Red uses danger. No new colors, translucency or dependency.

## E. Validation

Production checks cover the pen and existing highlighter/colors/Focus/menu behavior. Light/dark 850x600 screenshots were inspected. TypeScript/Vite build and 21st review are recorded with installer results in release/draw-verification.json. The frontend builds into dist-draw to avoid another chat replacing its assets. Native visual checks remain unperformed.

## F. Do / Don't

Do preserve the editor, drawing and marker styles independently, read-only Reference, safe imports and native scrolling when idle. Don't merge tool histories accidentally, clear markers with the drawing command, bounce paths, paint through the native text editor when inactive or add another drawing engine.
