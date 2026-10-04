# Live Windows theme icons — Scribly 1.3.11

## Windows 11 taskbar size correction

The user's screenshot showed that 1.3.10's taskbar still displayed the blue icon
in dark mode. Read-only inspection of that actual running app found correct
sand artwork in its 20×20 ICON_SMALL and 40×40 ICON_BIG handles, plus the correct
dark Shell resource. No Scribly shortcut was present in the pinned-taskbar folder.
These checks demonstrate why correct handle colors and metadata alone were
insufficient to verify the rendered taskbar.

Windows 11 can leave the taskbar icon unchanged when ICON_SMALL is too small
for its display scale. A [Microsoft Q&A report with Microsoft staff acknowledgement](https://learn.microsoft.com/en-ca/answers/questions/712281/wm-seticon-does-not-update-taskbar-icon-in-windows)
describes the same size-dependent behavior and using a 256px small-icon resource.
The 1.3.11 update assigns the existing bundled 256px frame to that slot. Windows
scales it for the caption/taskbar; ICON_BIG retains the Windows large-icon metric.
Four handles still cover both themes and all switches reuse them. No images or
dependencies were added. The ICO files already contain the needed frame.

The native regression now requires the small-icon slot's actual bitmap width to
meet the Windows large-icon metric. This added check fails on installed 1.3.10.
It also continues checking theme pixels, Shell identity, resource contents,
cached handles/files, rapid changes, reload, and clean exit.

The computer-use API exposes the Scribly window but not a targetable taskbar
capture surface. [NEEDS INPUT] Rendered taskbar confirmation remains separate
from the native checks; it must not be inferred from a passing handle/property test.

## 1.3.10 Shell metadata changes

The browser favicon and Win32 caption/large icon slots already followed the
resolved Light/Dark/System appearance. The installed 1.3.9 diagnostic window
had no Shell taskbar-group properties, so Windows could fall back to the
executable/shortcut's static icon. The extended native regression failed on
that missing identity before the fix.

`src-tauri/src/app_icon.rs` now sets the per-window AppUserModelID and relaunch
command, display name, and theme-specific ICO resource before assigning both
native icon slots. The stable `com.still.notes` identity preserves grouping.
The frontend's existing serialized queue continues to discard superseded
requests and uses the resolved System appearance.

Four cached HICONs cover both themes. The two ICO resources are written only
when their versioned cache is missing or differs from the bundled bytes; reads
are bounded and writes use atomic replacement. Mode changes reuse both handles
and resource files. No frontend asset or runtime dependency is added. Windows
bindings extend the already-used Rust `windows` crate.

Shell string variants use Windows allocation and are cleared after SetValue.
A window subclass clears the four Shell properties before forwarding
WM_NCDESTROY, including normal close and diagnostic app exit.

The standalone executable, installer, and a pinned shortcut while the app is
closed retain their packaged icon. Dynamic resources describe the running
window. The automated checks inspect real native handles and Shell properties;
they do not visually verify Explorer's rendered taskbar or pinned shortcuts.

## Validation

The release and installed Scribly 1.3.10 executable both passed the original
handle/property checks, which did not check the small-icon resolution.
The installed copy was updated silently while the app was closed. See the
[verification record](../release/live-icon-verification-1.3.10.json),
[release native samples](../release/icon-test-c53d17445889454c99637863f99c2f22/icons.json),
and [installed native samples](../release/icon-test-7f04211412f84241bef0fe9e1875656a/icons.json).
The optimized executable grew by 11,264 bytes against installed 1.3.9; this is
a file-size measurement, not a RAM/frame-time benchmark.

- `npm run build` (through `npm run package`): TypeScript and Vite production build.
- `npm run check:rust`: formatting, Clippy with warnings denied, 18 tests passed;
  the unrelated PostgreSQL integration test remains explicitly ignored.
- `tests/app-icon.spec.ts`: 2 browser tests passed. A cold development-server
  load exceeded 30 seconds; rerun with a 120-second timeout passed.
- `scripts/test-native-app-icon.ps1`: checks the actual release WebView2 window
  in an isolated notebook/profile. Seven samples cover Light, Dark, System in
  both appearances, 20 reversals, and restored dark mode after reload. It checks
  small/large pixels, resource hashes, relaunch identity, handle reuse, and no
  file rewrites during switches. The release report records final results.
- The native lifecycle unit test verifies string values survive their input
  buffers and are cleared when a hidden test window is destroyed.

## API references

Microsoft's [window property-store documentation](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetpropertystoreforwindow)
requires clearing window properties before close and explains immediate SetValue
publication. The [RelaunchIconResource documentation](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource)
describes the taskbar-group icon and its explicit window AppUserModelID requirement.
