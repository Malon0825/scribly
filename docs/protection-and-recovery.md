# Backups, history, and Trash

Included in the locally built [historical build record](../tests/verification.md). The public 1.3.11 release does not include these changes; 1.3.12 has not been published. See the [enhancement plan](enhancement-plan.md) for delivery tracking.

## Backups

Open **Settings → Backups and recovery**. In Windows, choose a folder on this computer or a backup drive, then enable **Automatic daily backups**. The setting is off initially. A backup becomes due after 24 hours if the saved notebook revision has changed; Scribly checks while open and catches up on the next launch. There is no background service. **Backup now** also works with scheduling disabled and captures the current draft.

Scribly retains seven ordinary backups and three copies made before notebook replacement. Retention applies only to files in its backup index, not unrelated files in the chosen folder. Changing folders leaves old copies in their previous location. A failed write preserves previous successful backups and reports the problem. The UI distinguishes notebook saving from backup creation and shows the last successful ordinary backup.

Each `.scribly` copy includes current notes, boards, rich text, embedded images, ink, original text/code files, folder metadata, Archive, and Trash. Version history is local to this installation and is not included. Reusable note templates are still a later phase; existing board content is included. Copies are unencrypted. They use the same [portable file format and operation bounds](storage-and-large-files.md) as manual export, including its classic ZIP size bounds; these are not notebook storage quotas.

**Browser preview:** copies persist in IndexedDB on this browser/device. Clearing that browser's data removes the notebook, history, and these copies. Use **Download** to keep an independent copy. Windows backups are separate files in the selected folder.

## Restore a notebook

Choose **Preview restore** beside a retained copy, or **Restore from file…** for a `.scribly` or legacy Scribly JSON backup. Validation completes before the preview opens. Counts show notes, boards, folders, archived items, and Trash items. Corrupt or unsupported files leave the current notebook intact.

- **Import as new items** is the default. Existing notes remain; imported notes receive new IDs, folders match by name, and Archive/Trash states remain intact.
- **Replace this notebook** requires an explicit acknowledgement. Scribly first saves a complete recovery copy of the current notebook. If creating that copy fails or its folder picker is cancelled, replacement stops. Successful replacement retains the current app appearance and adopts the backup's notes and folders. Cancel or Escape before adoption leaves the current notebook intact.

Replacement does not import version history. History for items removed by replacement is removed, just as for permanent deletion; the pre-replacement copy preserves their current bodies, not all their historical versions. Download that safety copy if you need to keep it beyond the three-copy rotation.

## Version history

Use **Version history** from a note or board's options. Choose a dated version, inspect the read-only preview, then **Restore this version**. The current body is checkpointed first, so later content remains available in history after a restore. Today's folder and archive state remain unchanged.

Retention is bounded independently of live notebook capacity:

| Setting | Behavior |
| --- | --- |
| Automatic checkpoint | Outgoing saved title/content/board state when meaningful content changes; at least five minutes between automatic checkpoints for that item |
| Before restoration | An additional checkpoint regardless of the five-minute interval; abort restoration if it cannot be written |
| Count | Up to 20 retained versions per item |
| Age | Versions older than 30 days are pruned on a history-writing save/checkpoint |
| Payload | Shared 64 MiB serialized history budget; newest versions take precedence |

Editing continuously does not preserve every keystroke or every autosave. This is separate from editor Undo and crash recovery. A single outgoing body over the history budget is skipped during ordinary saving; live content is still allowed. Restoring an earlier version stops if preserving the current body would exceed that budget. Export a full notebook backup to preserve such content independently.

Windows stores history in PostgreSQL separately from live item rows. Browser preview stores metadata and bodies separately in IndexedDB, indexes entries by item, and loads only the selected preview body. Ordinary saves inside the five-minute interval do not scan all retained history. Both survive restart. Disk/browser quota or database errors remain visible; failed writes and revision conflicts stop restore without silently replacing the current content.

## Trash

**Move to Trash** replaces ordinary permanent deletion. The item keeps its full content and deletion timestamp, disappears from regular navigation/search/Reference, and becomes read-only in Trash. **Undo** is available immediately; **Trash → Restore from Trash** remains available after restart. Archive stays separate. Restoring a formerly archived item returns it to Archive.

Folder removal moves affected Trash items to Unfiled, just as current items lose that folder. Restoring otherwise returns to the original folder. Deleting the active or reference item chooses another eligible current item and clears the unavailable reference; deleting an inactive item preserves the current editor and draft.

**Delete permanently** is available only in Trash. **Empty Trash…** removes all Trash items. Both require confirmation; Cancel and Escape preserve the content. There is no automatic Trash expiry. A confirmed purge removes the item and its local version history. Existing portable backups are unaffected.

Trash still occupies storage. Its summary shows serialized note/board data and explicitly identifies original/attachment files as additional usage. It is not a total disk measurement or a capacity allowance.

## Migration and file retention

Native notebook metadata now uses format 5. Formats 2–4 still load and migrate through the existing per-item storage path. Portable backups with Trash use format 5 to prevent older apps silently dropping deletion state. Backups without originals/Trash can still use legacy JSON formats. Do not reopen a migrated native database in an older build; export a compatible portable backup before downgrading.

Image pruning protects current and archived notes, Trash, retained history, and recoverable/conflicting drafts in both localStorage and IndexedDB. The existing conservative image age policy remains. Original-file garbage collection remains deliberately conservative: unreferenced originals and cancelled import staging files can remain on disk. Permanent deletion therefore does not promise immediate reclamation of every file. There is no application cap on overall live notebook storage.

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
