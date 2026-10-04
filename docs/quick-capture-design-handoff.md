# Phase 6 Quick Capture design handoff

## Overview

Quick Capture is an **Operate** surface: write a short note into Inbox, save it, and optionally open the saved note in the notebook. This is an ordinary extension of the existing Windows notebook identity. It uses a compact form rather than adding another editor, navigation rail, or formatting surface. The capture form is shared by the native window and browser modal.

This handoff describes the finished, frozen `src/QuickCapture.tsx`, `src/quick-capture.css`, `src/QuickCaptureSettings.tsx`, and `src/QuickCaptureWindow.tsx`. The incumbent `.21st/DESIGN.md` and `.21st/design.json` remain preserved. This document adds surface-specific guidance; it does not replace the global visual system or repair pre-existing drift.

## Colors

The form consumes existing semantic CSS variables. The solid reading surface uses `--panel`, text uses `--fg` and `--text`, boundaries use `--line`, focus and caret use `--accent`, selection and press feedback use `--active`, hover uses `--hover`, and actionable failures use `--danger`. Locked fields use `--chrome` to distinguish retained text from editable text.

Light mode retains the incumbent cool chrome and blue actions. Dark mode inherits the current warm neutral surfaces and sand accent; it does not introduce a second palette. The capture window resolves the saved Light/Dark/System preference on mounting, window focus, storage events, and changes to the operating system color preference.

## Typography

Controls inherit the existing Segoe UI/system typography. The native form title is a compact semibold heading (22px, weight 600, line height 1.25). Field labels are semibold (14px), optional-title wording is regular, fields use readable body text (14px, line height 1.5), helpers use quieter text (12px), and feedback/actions use compact text (13px). Labels stay visible while typing; no placeholder carries a required instruction.

## Layout

The native design target is the supplied 520 × 480 window. The form fills its surface, uses native vertical overflow, and starts with comfortable padding (22px). At widths up to 400px, native padding reduces (16px). The browser form uses the existing Dialog container at a maximum width of 520px, bounded by the viewport with 16px space on each side.

Reading order is title, optional note title, note text, Inbox/keyboard hints, status or recovery feedback, and actions. The body flexes to available space, with a minimum text area height (120px); browser mode gives the body extra room (170px minimum). The action row wraps rather than clipping, keeps Close at the start, and places Open in notebook and primary Save at the end. Helpers wrap when space is constrained. Long errors break safely within their container.

This capture surface does not resize, remount, or animate the notebook document. Native scrolling and text selection remain the form's direct manipulation mechanisms; custom drag, rubber-banding, and momentum are N/A.

## Elevation & Depth

Text fields and capture content remain solid. Browser capture reuses the existing modal panel, dimmed backdrop, theme-aware border/shadow, and focus trap. Native capture uses its window rather than a nested visual scrim. There is no new glass layer, decorative backdrop effect, or capture-specific shadow vocabulary. The existing reduced-transparency preference removes backdrop blur and retains a solid tinted dim layer.

## Shapes

Fields and action buttons use gently rounded corners (8px), with thin semantic borders on fields. Actions have a practical minimum height (38px). The browser container inherits the existing dialog geometry; the native frame belongs to the existing Windows window implementation. This handoff does not establish new global radii or claim a native frame measurement from browser evidence.

## Components

### Capture form and labels

- **Note title (optional)** precedes **Note text**. Its helper states **Up to 120 characters.** The HTML input allows 240 code units; the helper communicates the product title limit rather than redefining the storage contract.
- **Destination: Inbox** stays visible beside **Ctrl+Enter to save**. Ctrl+Enter follows Save; it does not activate Open in notebook. Composition input is excluded from shortcut handling.
- Ready, editable capture focuses the text area. The browser Dialog also targets that field and restores the opening control on dismissal.

### Actions and feedback

| State | Visible behavior and action contract |
| --- | --- |
| Loading | `Loading retained draft…`; fields are read-only and save actions unavailable. A loading failure provides `Retry loading`. |
| Editable | Title/text update immediately. Empty or whitespace-only capture cannot submit. `Save` and `Open in notebook` submit meaningful text. |
| Saving | `Saving…` and busy semantics accompany submission. Fields become read-only; duplicate submission is blocked. Close remains available through the retention path. |
| Pending acknowledgement | Retained text stays read-only. The form explains that it is waiting for notebook confirmation and offers `Retry save`. Close retains the pending capture. |
| Confirmed saved | The form clears the acknowledged draft and shows `Saved to Inbox.` inline, with `Open saved note`. Ordinary Save leaves capture available for another note. |
| Open requested | `Open in notebook` first submits and waits for the saved-note acknowledgement, then requests opening. An opening failure reports that the note was saved. |
| Failure | Alerts retain the text and expose the applicable recovery action. A draft-retention failure asks the user to retry before closing; no success is invented. |

Close, Escape, browser dialog dismissal, and native close requests share the latest-draft retention path. Draft writes are serialized and drained before closing; a pending capture already contains retained text and is not replaced by a fresh draft. Save acknowledgement, rather than elapsed animation or an optimistic button response, owns success.

### Startup settings entry

Quick capture belongs in the existing Startup settings section. The in-app **Quick capture…** entry remains available in browser preview. Windows settings additionally offer **Enable global capture shortcut**, the existing AppSelect for **Capture shortcut**, and status reporting the actual registration state. Choices are Ctrl+Alt+N, Ctrl+Shift+Space, and Alt+Shift+N. The wording distinguishes capture while the app is running from the separate Windows startup setting. Browser wording explains where the global shortcut is available. Preference failures use the existing alert treatment.

### Motion, focus, and accessibility

Capture buttons highlight immediately through `:active`, with no delayed transform or bounce. Activation remains ordinary click/keyboard semantics. Focus is visible through an accent outline (2px with a 3px offset). Error messages use alert semantics; progress and acknowledgement use polite status semantics; the form advertises busy state.

Browser entry inherits the existing short opacity materialization (100ms) and immediate dismissal. The shared stylesheet overrides old modal keyframes; no new spring, gesture animation, positional transition, or layout animation was introduced. Reduced motion removes transitions and transforms, including the inherited dialog transition. No saving or closing operation waits on motion completion.

## Do's and Don'ts

- Do preserve the shared form, existing theme tokens, Windows conventions, solid text surfaces, and inline save acknowledgement.
- Do retain the latest draft before dismissing and keep pending capture text readable with explicit Retry recovery.
- Do open only the acknowledged saved note, and restore browser focus to the capture owner when the dialog closes.
- Don't add a formatting toolbar, second editor, glass behind text, celebratory save animation, sound, or arbitrary timeout-based success.
- Don't infer global shortcut registration, native focus behavior, or packaging readiness from browser screenshots.

## Evidence and delivery boundary

The implementation and incumbent design files above were read for this documentation pass. Existing final captures supplied by the build thread are the visual evidence:

- [Wide light browser capture](../.impeccable/review/phase6-capture-wide-light.png)
- [Narrow dark browser capture](../.impeccable/review/phase6-capture-narrow-dark.png)
- [Dark capture-window surface](../.impeccable/review/phase6-capture-window-dark.png)

The build thread reports that it opened all three final captures and confirmed their content and fit. This documentation pass did not repeat captures, context loading, the detector, builds, or tests. The independent review and its actual disposition belong in [Quick Capture UI review](quick-capture-ui-review.md); this handoff does not independently certify runtime behavior.

The build thread subsequently verified the actual global shortcut from Explorer, isolated WebView2 draft retention and saving, pending-capture retry, restart recovery, shutdown retention of the latest draft, and shortcut conflict handling with two running app instances. These workflow results are recorded in [native and release verification](../release/build-1.3.16-20261004-213510/verification.json). It also inspected the [final native form capture](../release/capture-webview-test-1ad99aab2f3c4b26b5102a37f9fa17fe/capture-native.png) and reports that the controls fit.

**[NEEDS INPUT]** Desktop theme propagation, frame geometry at target DPI, minimum-window and maximized geometry, and frame performance remain unmeasured. The independent UI review retains its original scope; these later native workflow results and the build thread's capture inspection do not constitute an independent native visual ship verdict.
