# Protection UI review

Reviewed 2026-10-04 for the 1.3.12 development sources. This is a scoped extension for backups, version history, and reversible Trash, following [AGENTS.md](../AGENTS.md) and the incumbent [.21st design guidance](../.21st/DESIGN.md) and [decision record](../.21st/design.json). It does not establish a new visual system or audit the whole app. Feature behavior and retention limits are documented in [protection and recovery](protection-and-recovery.md); delivery tracking is in the [enhancement plan](enhancement-plan.md).

## Decisions grounded in the implementation

- Palette: reuse light blue-gray chrome and blue actions, with the existing charcoal/sand dark theme and semantic text, border, danger, and contrast tokens.
- Typography: retain Segoe UI/system controls; backup copy uses the existing scaled 13px body and 17px section heading, with 15px history prose previews.
- Hierarchy: Settings owns backup controls; history opens a centered read-only preview; Trash remains a sidebar destination alongside Archive. The writing/Reference hierarchy stays intact.
- Materials: reuse solid Dialog, AppSelect, and ActionPopover surfaces, existing rounded geometry, theme-aware shadows, and the modal dim/blur backdrop. History is bounded to 880px with a natively scrolling preview capped at 45vh; backup actions wrap and destination paths can break safely.
- Interaction: inherit immediate button feedback, normal click/keyboard activation, dialog focus handling, and the existing 100ms opacity entry with instant reduced motion. No new animation, spring, dependency, or translucent reading surface was introduced.

The relevant source is [BackupSettings](../src/BackupSettings.tsx), [BackupRestoreDialog](../src/BackupRestoreDialog.tsx), [HistoryDialog](../src/HistoryDialog.tsx), the scoped [App](../src/App.tsx) integration, [ActionPopover](../src/ActionPopover.tsx), shared [Dialog](../src/Dialog.tsx), and [styles](../src/styles.css).

Backup restore defaults to importing new items. Replacement requires acknowledgement and a complete protective copy; failure or cancellation stops adoption. History preserves the current saved body before restoration and retains today's organization. Cancelled or stale restore work cannot commit later through an animation callback. Trash offers immediate Undo and later restoration; permanent deletion and Empty Trash retain confirmation. Read-only Trash/history and separate notebook/backup error feedback preserve the existing safety model.

## Independent review result

**Disposition: ship.** The reviewer's final verdict scored all three listed material fixes resolved. That verdict covers those fixes, not a whole-app audit.

| Material finding | Finished change and evidence |
| --- | --- |
| History picker diverged from app controls | Replaced the native select with AppSelect, visibly and accessibly labeled **Saved version**. Keyboard ArrowDown and nested Escape were verified. |
| Dark destructive action lacked sufficient foreground contrast | Danger buttons use the existing `--on-accent` foreground; the reviewed dark pair measures 7.36:1. |
| New protection explanations and timestamps were too faint | Backup paragraphs/list timestamps and history/restore explanations use `--text`; the reviewed light pair measures 8.13:1 on white. |

The four recaptured files were opened during this documentation pass and show the named surfaces without blank, half-loaded, or missing regions: [desktop history](../.impeccable/review/phase2/desktop-history.png), [narrow Settings](../.impeccable/review/phase2/narrow-settings.png), [narrow Trash confirmation](../.impeccable/review/phase2/narrow-trash.png), and [native history](../.impeccable/review/phase2/native-history.png). These are evidence of the inspected frames, not proof of every interaction or theme combination.

## Validation and limits

The build agent recorded the following completed checks; this documentation-only pass reviewed the source, captures, and native report without rerunning them:

- Final `npm run build` passed, retaining the existing large-chunk advisory.
- Browser checks passed: 24 menu/deletion/drag and 54 storage/recovery/image/protection checks; later focused runs passed 15 protection/deletion and six board/history checks. Latest production protection/deletion passed 12 checks, with four development-only harness/failure-injection checks intentionally skipped. These groups overlap and are not an additive test total.
- Rust passed 32 unit checks and three isolated PostgreSQL checks.
- The isolated Windows WebView2 workflow passed twice. The [latest native report](../release/protection-webview-test-a761764a694549cfb111a10452d95507/protection.json) records format 5, history surviving reload, restored Trash, an original-file backup hash, and one protective copy. The installed notebook was untouched.

Native folder chooser/save-dialog interaction and a physically full backup drive remain untested. Simulated writer-full and disconnected-folder failures were tested. No installer was published.

## Incumbent records preserved

No PRODUCT.md, root DESIGN.md, or new design sidecar was created. The existing `.21st` files were preserved. Their opening 12/24px and 160–220ms shorthand predates their later shared-dialog guidance and the current 23px dialog/100ms opacity implementation; it was not promoted into a new rule or repaired in this scoped pass. The older decision that live/archived items offer permanent deletion is now superseded by this feature's reversible Trash behavior, documented here without rewriting the design record.

The detector's pre-existing blockquote accent-border finding at `src/styles.css:986` is outside this feature. It was neither repaired nor canonized as a new system rule; the feature review does not authorize unrelated editor styling changes.
