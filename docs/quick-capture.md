# Quick capture

Quick capture puts a thought into **Inbox** while you keep your current note open. Open it from **Settings → Startup → Quick capture…** and enter a note title and note text.

- **Save** creates the note in Inbox and shows **Saved to Inbox.** The capture stays open with empty fields so you can capture another thought; use **Close** to return to your existing work. **Ctrl+Enter** does the same.
- **Open in notebook** saves the capture and then selects its new note in the main notebook.
- **Escape** or **Close** dismisses the capture without discarding its draft. Reopening capture restores the title and text, including after restarting or reloading the app.

Capture accepts plain text, without attachments: up to 256 KiB of UTF-8 text and a title of up to 120 Unicode characters. These are capture-operation limits, not an overall notebook quota. Your main note, its latest unsaved writing, and the Reference note remain intact. Inbox is created when needed. Each capture is an ordinary note independent of Inbox folder templates or Copy last note.

On Windows, enable the global shortcut in **Settings → Startup → Quick capture**. The default is **Ctrl+Alt+N**; the available alternatives are **Ctrl+Shift+Space** and **Alt+Shift+N**. The shortcut opens the capture window while Scribly is running, even when another application has focus. It does not start a closed app. **Start with Windows** is a separate setting. If another application owns the shortcut, choose another combination or use the Settings action.

The browser preview provides the same in-app capture action. Browsers cannot register this Windows global shortcut, so its desktop setting is unavailable there.

A capture is successful only after notebook persistence acknowledges it. If saving fails, keep the draft and retry after addressing the error. Retrying uses the same capture identity so it does not create a second note. Only one capture can be pending at a time. Its text and the latest draft are retained for recovery; do not clear application storage while recovering a failed save.

## Verification

See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
