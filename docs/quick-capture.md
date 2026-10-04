# Quick capture

Quick capture puts a thought into **Inbox** while you keep your current note open. Open it from **Settings → Startup → Quick capture…** and enter a note title and note text.

- **Save** creates the note in Inbox and shows **Saved to Inbox.** The capture stays open with empty fields so you can capture another thought; use **Close** to return to your existing work. **Ctrl+Enter** does the same.
- **Open in notebook** saves the capture and then selects its new note in the main notebook.
- **Escape** or **Close** dismisses the capture without discarding its draft. Reopening capture restores the title and text, including after restarting or reloading the app.

Capture accepts plain text, without attachments: up to 256 KiB of UTF-8 text and a title of up to 120 Unicode characters. These are capture-operation limits, not an overall notebook quota. Your main note, its latest unsaved writing, and the Reference note remain intact. Inbox is created when needed. Each capture is an ordinary note independent of Inbox folder templates or Copy last note.

On Windows, enable the global shortcut in **Settings → Startup → Quick capture**. The default is **Ctrl+Alt+N**; the available alternatives are **Ctrl+Shift+Space** and **Alt+Shift+N**. The shortcut opens the capture window while Scribly is running, even when another application has focus. It does not start a closed app. **Start with Windows** is a separate setting. If another application owns the shortcut, choose another combination or use the Settings action.

The browser preview provides the same in-app capture action. Browsers cannot register this Windows global shortcut, so its desktop setting is unavailable there.

A capture is successful only after notebook persistence acknowledges it. If saving fails, keep the draft and retry after addressing the error. Retrying uses the same capture identity so it does not create a second note. Only one capture can be pending at a time. Its text and the latest draft are retained for recovery; do not clear application storage while recovering a failed save.

## Verification status

All four focused Chromium browser checks in `tests/quick-capture.spec.ts` passed together in 32.1 seconds on October 4, 2026, after updating entry navigation for the Settings Startup section. They cover preserving unsaved main writing, Save versus Open, draft retention and Ctrl+Enter, and failed-write retry without duplication. Two earlier checks timed out during cold development-server page loading; those checks passed when rerun with the suite's startup allowance increased to 90 seconds. Results are recorded in `release/phase6-browser-checks.log`.

Optimized Windows WebView2 verification passed the actual Ctrl+Alt+N shortcut from Explorer with capture visibility and focus; repeated opening reused one capture window. Capture-window workspace commands were denied. Concurrent main writing and Reference stayed intact, and Unicode/plain-text escaping and Inbox placement passed. Escape, the Close button and a native window close request retained the latest draft. Open selected the note only after acknowledgment. Injected failure at the real workspace IPC boundary retained the pending capture; retry reused its ID. Restart committed it once and preserved the main recovery draft. Ordinary main-window shutdown drained the latest capture text, and shortcut preferences registered/released across restart. See the [native workflow report](../release/capture-webview-test-1ad99aab2f3c4b26b5102a37f9fa17fe/capture.json).

A genuine shortcut conflict between two isolated app instances retained the enabled preference, reported registration failure, and recovered after shortcut release/reregistration. See the [shortcut conflict report](../release/capture-conflict-test-2dd24b23d20f40fc8aefc431c91553df/capture-conflict.json). Two scoped Rust tests, formatting and Clippy passed; the full suite was not rerun.

The [local 1.3.16 Windows installer](../release/Scribly_1.3.16_x64-setup.exe) is 61,072,480 bytes, SHA-256 `772617A939F206E5E3C3D76D28B0E2ECE854F48E0421882D477ACD33993222E9`. It has not been installed or published. Frontend, optimized native and NSIS packaging generated successfully; the outer PowerShell wrapper returned exit 1 after incorrectly treating informational stderr as an error once the artifact was complete. No rebuild was performed. Final 158 input and 12,504 generated-asset hashes stayed unchanged except for two documented diagnostic shutdown-script amendments. The [release audit](../release/build-1.3.16-20261004-213510/verification.json) records the discrepancy and evidence.

Native RAM/frame performance, full-drive behavior and power-loss resilience remain unmeasured. The scoped checks do not establish those guarantees.



