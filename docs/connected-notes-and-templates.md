# Connected notes and reusable templates

Phase 4 adds internal note/board links, derived backlinks and independently stored note templates. Windows desktop and browser preview use the same controls.

## Connect items

Select note text and use **Link to item** or **Ctrl+L**. Choose a live note or board, then Insert link. With no selection, its current title becomes the label. Cancel restores the selection. In a board, the command links selected elements or adds a text label when nothing is selected; insertion is one drawing Undo step.

An internal link stores the target's stable ID. Rename or move the target without breaking the connection. Labels retain the text you inserted and remain editable; they do not automatically mirror later target renames. Ordinary clicks in editable note text retain editing. **Ctrl+click** opens the target; **Ctrl+Alt+click** opens it in Reference. **Alt+click**, or Enter on a keyboard-focused internal link, shows Open/Open in Reference actions. Board links use the canvas link control; Alt opening chooses Reference. Reference links open the target in the main document.

Open the collapsed **Backlinks** section beneath an item to find notes and boards that actually link to it. Template records and Trash sources are excluded; archived sources are labeled. Deleted board elements do not contribute links. Backlinks are derived from current content, cached per unchanged item object, rather than saved as a second editable list.

Archive and Trash targets remain connected and open read-only. Restore them before using them in Reference or creating new connections with the picker. Missing targets retain their link and show an explicit unavailable state; restoring the same ID reconnects it. Only HTTP/HTTPS external links open, through the system browser on Windows or a separate browser tab in preview. Other URL schemes are rejected.

## Reuse a note

Use **Note options → Save as template…** on a live text note. Name the template, choose its title pattern and optional checklist reset, then save. The snapshot includes formatting, images, ink and original-file references. Editing or deleting its source does not change the template. Board templates remain separate.

Use **New from template…** in the sidebar or folder options to create an independently editable note. An optional title replaces the automatic base title. `{{title}}` and `{{date}}` are expanded in the title pattern and note text; date uses the local calendar day in YYYY-MM-DD format. Original file bytes and link/image attributes stay unchanged. Checklist reset applies only to the new note and can be changed for each creation.

**Settings → Manage note templates…** lets you rename templates and change title/checklist defaults. These changes affect future notes. To change the saved body, edit a normal note and save a new template. Permanent template deletion requires confirmation, clears folder defaults that reference it, and preserves existing notes.

In **folder options → Default note template**, select a template or None. A configured template takes priority over Copy last note for ordinary New note/Ctrl+N creation in that folder. With None, the existing Copy last note setting continues to apply. Explicit duplication/import/weekly content bypasses those defaults.

## Persistence, backups and compatibility

Templates use the same per-item body storage as notes, with no overall notebook quota. They count toward actual storage usage and the existing per-item rendering/save budgets; this feature does not make every arbitrarily large rich-text body safe to edit. Images are content-addressed and retained while any note/template, history or recovery copy references them. Originals remain conservatively retained.

Notebook JSON/`.scribly` backups include templates, settings, images and referenced originals. `.scribly` is required when originals are present. Import assigns new IDs to every imported item/template, remaps internal connections and self-links, and remaps defaults on newly imported folders. Existing folders matched by name keep their own settings. Duplication remaps self-links to the copy and keeps other targets. Template creation similarly remaps template self-links to the new note.

This adds the template item kind to notebook documents; desktop persistence writes format 5. **Scribly 1.3.14 or newer is required to read a notebook/backup containing note templates.** Earlier apps reject that kind; do not downgrade a template-containing notebook. Existing notebooks without templates retain their prior format compatibility. Internal links in older editors may render as ordinary anchors; use this release for controlled internal navigation.

Plain-text note export includes the label and `(Scribly item: ID)` so a connection is identifiable outside the app. Formatted Markdown/PDF note export is Phase 5: the planned behavior is readable labels with stable ID references, without pretending a PDF can navigate this private local database. Board image/SVG exports are visual artifacts; standalone `.excalidraw` files preserve link IDs but have no notebook target resolver outside Scribly. Use a notebook backup to transfer a connected graph with its targets.

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
