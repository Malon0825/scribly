# Find, replace, pins, and recently opened items

Phase 3 is complete in the [local Scribly 1.3.13 Windows installer](../release/Scribly_1.3.13_x64-setup.exe). Production browser and optimized Windows WebView2 checks passed; local release evidence is recorded in [verification](../tests/verification.md).

## Find and replace

Open a text note and press **Ctrl+F**, or choose **Find in note** in Formatting or the note's options. Type literal text to see a match count and highlights. Use the arrows or **Enter / Shift+Enter** for next/previous; navigation wraps. **Escape** closes Find and restores the original editing position and scroll position, mapped through replacements made while Find was open.

**Ctrl+H** opens replacement controls. **Match case** and **Whole word** apply to both finding and replacement. Whole-word boundaries recognize Unicode letters, numbers, combining marks and connector punctuation, including underscores. Searches span formatting marks within a text block and include code text; they do not join separate paragraphs or cross images/other embedded blocks. Empty queries never replace anything. Replacement is literal: `$`, backslashes and angle brackets are inserted as text, not expressions or HTML.

**Replace next** replaces the highlighted match and advances. **Replace all** replaces the current note's matches together. Each operation is one Undo step, separate from earlier typing. Replacement inherits the first matched character's formatting; surrounding formatting, code language, images and block-anchored ink remain. Replacement can be empty to remove matched text. Reference, archived notes and Trash remain read-only; archived/Trash notes support Find without replacement controls.

Find preserves the live editor instance and does not save its highlights. Counting and navigation cover all matches; painting is bounded to nearby matches in very large notes. This is a rendering optimization, not a limit on stored notes. Original-file blocks remain immutable and their contents are excluded; Find searches the note text and annotations around them. Full-file original searching/editing remains future work.

Find opens within the writing panel. At widths up to 1050px, it closes the overlapping Reference panel so its controls remain usable, while preserving the selected reference item. Use the existing Reference button to reopen it. Reduced motion uses the same immediate controls; no new animation was added.

## Notebook search and boards

**Ctrl+K** searches item titles, note text, original filenames, board text and frame names. Results include an excerpt around the first text match. Choosing a note result reveals its match in Find, or selects a matching title. Original-filename matches reveal the source viewer without scanning the original bytes. The query stays in place during ordinary result navigation.

Choosing a board result reveals and selects the first matching text shape or frame, without changing the drawing or its saved modification date. On a board, **Ctrl+F** opens notebook search; **Ctrl+H** explains that board labels are edited on the canvas. Rich-text replacement is limited to text notes. Deleted shapes, image contents and unlabeled geometry are not searched; Reference remains a static preview.

## Pins and recent items

Choose **Pin item / Unpin item** from a live note or board's options. The compact **Pinned** section provides shortcuts without moving items in their folders. Pins persist in browser/native storage and travel with items in backups. Duplicating an item creates an unpinned copy.

**Recently opened** retains the last ten distinct live items opened in the main document, newest first. Opening, creating, importing or restoring an item can update this list; typing, autosave, pinning and opening Reference do not reorder it or change item modification timestamps. The section starts collapsed to keep writing/navigation compact. Both sections support ordinary keyboard/button navigation.

Archive and Trash hide pinned shortcuts while retaining the pin on the item; restoring it returns its pin. Moving into Archive/Trash removes its recent entry; restoring/opening it adds a fresh recent entry. Permanent deletion removes both references. Folder removal does not break shortcuts because they use stable item IDs. Backup imports preserve pins on remapped new items, but do not import another notebook's recent-open history; replacement starts a fresh recent list.

Pins and recent IDs are optional fields in the existing format 5, so old notebooks open without a mandatory schema migration. Native and browser validators reject malformed pins, duplicate/missing recent IDs and lists beyond the bound. Per-item storage, recovery records and backups retain this metadata independently of note bodies. Existing history restoration preserves today's pin and organization. The overall notebook storage limit remains removed.

## Validation limits

Browser checks cover Unicode/formatting/code matching, empty/literal queries, replacement Undo/Redo, read-only notes, image/ink retention, editor identity/caret restoration, search navigation, board reveal/pins, recent ordering, Archive/Trash/purge and narrow/light/dark/reduced-motion operation. Native validation uses a separate notebook profile; it does not modify the installed personal notebook. Installer installation, interactive native pickers, physical disk-full behavior and sustained RAM/frame profiling are separate checks.
