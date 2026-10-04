disposition: ship

Scope: Phase 6 browser Quick Capture form and its inspected application integration. This is not approval of the packaged Windows workflow or native titlebar. Missing inputs: native runtime captures, measured contrast and latency, System-theme/maximized evidence, PRODUCT.md and DESIGN.md; no approved comp or QUALITY BAR card applies to this established product extension.

## persistence

Pass for the established-extension review scope. AGENTS.md, `.21st/DESIGN.md`, `.21st/design.json`, and the incumbent implementation supply the binding product/design guidance. The two persisted incumbent artifacts were inspected once: system app typography, solid reading surfaces, shared Dialog/AppSelect, immediate press feedback, reduced motion, and the explicit warm charcoal/sand dark theme agree with this extension. Root PRODUCT.md and DESIGN.md are absent; the parent reports that skill context directed this narrow extension to preserve the existing artifacts without drift repair or a new surface brief. The main Impeccable skill permits narrow incumbent refinements without blocking on initialization. No concept roll, comp round, raster asset, or new-world build-state obligation applies here.

Reviewed `src/QuickCapture.tsx`, `src/quick-capture.css`, `src/QuickCaptureSettings.tsx`, and the capture integration in `src/App.tsx`. The supplied final captures dated 2026-10-04 21:42:50–56 all exist and show the named surface, settled, readable, and without blank or clipped regions:

- `.impeccable/review/phase6-capture-wide-light.png`: 1440 × 920 browser modal.
- `.impeccable/review/phase6-capture-narrow-dark.png`: 850 × 600 browser modal.
- `.impeccable/review/phase6-capture-window-dark.png`: 520 × 480 standalone form content, without OS chrome.

The parent reports one detector pass with zero findings, four focused browser checks passing, and scoped Rust validation passing. Those results are supplied evidence, not checks repeated by this reviewer. Product sources remained frozen during this documentation review.

## fidelity

| Element or promise | Verdict | Evidence |
| --- | --- | --- |
| TYPE | Match | Compact system typography, descriptive labels, optional-title disclosure, and restrained heading hierarchy in all three captures. |
| MATERIAL | Match | Solid form/text surfaces, restrained borders, existing modal focus treatment; no simulated physical material or decorative glass. |
| GROUND | Match to incumbent tokens | Capture CSS uses `--panel`, `--fg`, `--text`, `--line`, `--accent`, `--active`, `--hover`, and `--danger`. Warm dark colors are existing current theme authority and must be preserved. No comp supplies a separate pixel target. |
| Primary capture hierarchy | Match | Optional title precedes the main text field; Inbox destination and Ctrl+Enter hint sit below; Save is the strongest action. Form controls and footer remain visible in each required capture. |
| Browser modal / standalone form | Acceptable adaptation | Protected capture focus in browser uses existing Dialog integration; the requested Windows capture window uses a standalone form. The latter omits the browser modal's duplicated heading and close icon arrangement. |
| Save and Open acknowledgement | Match in inspected source | `save()` submits after draft flush; `refresh()` clears the draft and presents success only after the expected saved ID is acknowledged. Open after save follows that acknowledgement; ordinary Save leaves inline confirmation. Runtime native persistence is outside this verdict. |
| Pending and recovery | Match in inspected source | Pending fields are read-only, status remains explicit, Retry save is present, and Close remains available. Loading/save/close failures expose an alert and recovery instruction without intentionally discarding text. |
| Draft retention on dismissal | Match in inspected source | Close/Escape flush before hiding; native close is intercepted; shutdown drains through the application integration. Browser behavior is supported by supplied focused checks; native shutdown behavior remains unverified here. |
| Settings discovery | Match in inspected source | Startup extras contain Quick capture, optional global shortcut enablement, predefined shortcut choices, registration status, and warning/error output. Browser copy explains that the global shortcut belongs to Windows. Settings was not included in the capture set. |
| Title limit | Acceptable adaptation | The hint is 120 characters; `maxLength={240}` permits UTF-16 surrogate pairs. Parent confirms service/native validators count Unicode code points and reject values over 120 with a visible error. Changing the DOM limit to 120 would incorrectly restrict such text. |

Bounded AGENTS decisions (no screen-wide motion change):

- **A — Feel:** Static captures establish hierarchy/materials only. Runtime press latency, focus restoration, and reduced-motion feel are `[NEEDS INPUT]`; no numeric runtime score is invented. Custom drag, velocity handoff, and spring settling are N/A for this form.
- **B — Interaction:** Plain-text entry, optional title, Save/Ctrl+Enter, acknowledged success, and optional Open form the direct path. Escape and Close retain the draft. Pending work blocks edits/submission for persistence correctness, not to finish animation.
- **C — Motion:** `.quick-capture button:active` removes transform and transition delay while applying `--active`; normal click/submit activation remains. No custom spring, gesture, layout animation, or new entry keyframe is introduced. Local reduced-motion CSS removes button transitions/transforms; shared Dialog behavior is inherited and not redesigned.
- **D — Materials:** Reading/input surfaces stay solid, theme tokens own colors, and modal depth is inherited. No new translucency, backdrop-blur animation, sound, or synthetic haptics is added.
- **E — Validation:** Required captures fit; parent reports modal form client/scroll height 376px and standalone client/scroll height 480px. Focus outlines, semantic labels, busy/read-only/disabled states, live status, and alert recovery exist in source. Native titlebar/shortcut registration, screen-reader announcements, zoom, measured contrast, System theme, and maximized geometry are not certified by screenshots or this source review. No tests/build/context/detector were repeated for a documentation-only handoff.
- **F — Preserve:** Keep writing primary, saving truthful, Close immediately usable, and text independent of animation completion. Do not add bounce, capture-editor gestures, decorative motion, or theme replacement.

## ceiling

Reached for the supplied form capture set and this established Operate surface. Additional expressive devices would compete with fast plain-text capture. Native OS chrome and the packaged global-shortcut/persistence workflow are separate pending release checks, not missing browser captures or grounds for an unrelated redesign.

## material_fixes

None within the inspected browser/form scope. At review time, the packaged Windows workflow and native titlebar evidence were pending; this review does not substitute for that evidence.

Delivery follow-up from the build thread: the optimized Windows workflow subsequently passed actual foreground shortcut/focus, reusable-window, concurrent-writing, failed-save/retry, restart and latest-draft shutdown checks, plus a separate actual shortcut conflict check. The root inspected the final native webview form capture. See the [release audit](../release/build-1.3.16-20261004-213510/verification.json). OS titlebar appearance, minimum/maximized/DPI geometry and native frame latency remain outside the visual review; the native close-request retention path was exercised. This supplied runtime evidence does not expand the independent review's browser/form verdict.

## keep

Preserve the solid current theme surfaces, optional title, immediate text entry, inline acknowledged saving, ordinary Inbox destination, visible retry recovery, and draft retention through dismissal.
