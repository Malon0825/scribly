# Rust architecture review — Scribly / Notify 1.3.9

Reviewed all native Rust source, the build/configuration and dependency manifests, and the frontend boundaries for saving, recovery, images, exports, startup settings and Windows icons. This is a native architecture review with application regressions, rather than a claim that every frontend line received a manual security audit.

## Findings implemented

| Problem in 1.3.8 | Result in 1.3.9 | Evidence |
| --- | --- | --- |
| Credential/port configuration was overwritten in place. Interrupted or failed writes could truncate the password needed by an existing cluster. Missing credentials could be regenerated beside existing data. | Sync a unique temporary file before replacing the destination. Read configuration with an 8 KiB bound, validate it, and preserve existing clusters when credentials are missing or damaged. | `files.rs`, `database.rs`; failed-write, replacement-failure, configuration retention and restart tests. |
| Delta application cloned every saved note, including large unchanged boards. Duplicate saved IDs silently collapsed. | Move owned note payloads into the ordered result; deserialize a typed delta envelope; reject corrupt IDs and inconsistent updates. | `workspace_delta.rs`; a 5 MiB unchanged image retains its original allocation, plus ordering/deletion/malformed-update tests. |
| Save validation allocated a complete JSON buffer twice just to measure its size. Attachment size caching eagerly performed file checks even on cache hits. | Stream UTF-8 JSON into a bounded counting writer once, reuse its count, and resolve each distinct attachment size once per validation. | `json_size.rs`, `workspace.rs`, `attachments.rs`; exact Unicode/escaping and size-bound tests. |
| Attachment reads/hashes held the PostgreSQL state lock. Reads trusted a prior metadata check for their allocation bound. | Clone only the stable storage path under the lock, release it before file I/O, and bound the read itself to 5 MiB plus one detection byte. | `commands.rs`, `files.rs`, attachment integrity/size tests. |
| Export overwrote an existing file directly; binary exports expanded bytes into JavaScript number arrays and JSON. Text exports had no native bound. | Shared temporary-file replacement preserves the previous destination on write/sync/rename failure. Images use raw Tauri IPC with an ASCII JSON filename header; international filenames round-trip. Native text/image bounds are 32/20 MiB. | `storage.ts`, `commands.rs`; browser native-service contract tests and Rust filename/file tests. |
| Registry commands ran synchronously on the UI thread; startup configuration construction could panic. | Use blocking workers for registry I/O and keep registration failures recoverable so notebook use remains available. Preserve confirmed-setting feedback and legacy startup migration. | `startup.rs`, existing settings regression checks and isolated release diagnostics. |
| PostgreSQL started before connection/schema failure had no owner to stop it. Status invocation failures were treated as “not running”; row decoding could panic. Queries had no statement/lock deadlines, and database errors lost useful detail. | Own the server across initialization, explicitly close it on normal exit outside the state lock, retain a teardown fallback, distinguish status errors, decode rows with `try_get`, and return actionable database errors. The app session has 15-second statement and 5-second lock deadlines. | `database.rs`; real-runtime conflict, locked-write timeout, restart and failed-schema server-cleanup integration test. |
| Native revisions accepted values outside JavaScript's safe range; native validation omitted automatic-title checks. | Validate the revision range before saving and title metadata before persistence. | Native revision/title tests; existing naming regressions. |
| Most native responsibilities occupied one file; formatting/lint checks were not repeatable project commands. | Separate IPC, persistence, pure validation, file replacement, startup and diagnostics. Add `npm run check:rust`, strict Clippy and an opt-in real PostgreSQL test run. Document Win32 unsafe preconditions and enforce `unsafe_op_in_unsafe_fn`. | Modules under `src-tauri/src`, `scripts/check-rust.ps1`. |

## Architecture and rationale

The frontend owns editing, drawing and reversible interaction. Thin async IPC adapters hand bounded blocking work to Rust. PostgreSQL owns durable revision-checked snapshots; app-owned files hold deduplicated note image attachments. Pure validation and delta modules work without a Tauri window or live database. No new application dependency, schema migration or storage-location change is required.

This division follows [Tauri's command/thread guidance](https://v2.tauri.app/develop/calling-rust/): synchronous work belongs in blocking workers, and raw bodies avoid JSON serialization of binary data. [Managed state already shares ownership](https://v2.tauri.app/develop/state-management/#do-you-need-arc), so another `Arc` would add no benefit here. The standard mutex remains appropriate because its guards never cross an `await`; it serializes a single synchronous PostgreSQL client.

Reclamation deliberately retains the database lock while reading persisted references and deleting old unreferenced files. Releasing it would create a save/deletion race. It also retains the frontend's recovery IDs and the existing 30-day grace period. Normal image reads and uploads do not require this ordering.

Rust's ownership model removes payload copies; `Result` handles recoverable I/O/configuration failures. Blanket replacement of every `unwrap` would obscure invariants: test fixtures, constant regular expressions and checked bundled-icon byte slices retain justified uses. User-driven file/configuration/database failures use errors. This follows the [Rust error-handling guidance](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html) and [argument/teardown guidance](https://rust-lang.github.io/api-guidelines/dependability.html). Normal shutdown calls an explicit fallible close; its bounded `pg_ctl` fallback can still block during exceptional teardown.

File replacement uses a temporary sibling on the same filesystem, `sync_all`, closure of its handle and [Rust's replacing rename](https://doc.rust-lang.org/std/fs/fn.rename.html). Tests establish retention on write/rename failure, not immunity to every filesystem or power-loss failure. PostgreSQL retains `fsync=on` and `synchronous_commit=on`. Status handling and session query deadlines follow [pg_ctl documentation](https://www.postgresql.org/docs/current/app-pg-ctl.html) and [PostgreSQL timeout semantics](https://www.postgresql.org/docs/current/runtime-config-client.html).

`spawn_blocking` is not cancellation: [started blocking tasks continue running](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html). Deadlines bound database work; a file chooser remains an explicitly user-controlled wait without holding the database lock. Existing frontend save queues and acknowledgement handling are preserved. We do not add an actor runtime, connection pool, async database driver or generalized repository layer without a measured concurrency need.

Excalidraw payloads remain validated `serde_json::Value` values so drawing-engine/custom fields survive exactly. The delta envelope is typed because its schema is small and stable. Entire notebooks are still stored as a single revisioned JSONB snapshot: eliminating unchanged-note clones and IPC payloads does not make PostgreSQL saves incremental. Loading only active/Reference bodies or migrating to per-note rows requires separate measurements and a tested migration design.

Existing release stripping, thin LTO and one codegen unit are retained. [Cargo documents the tradeoffs](https://doc.rust-lang.org/cargo/reference/profiles.html); these flags do not establish a universal speed advantage. No native RAM percentage, image-decoding saving or frame-time improvement is claimed from allocation/contract tests.

## Dependency and interaction findings

The final npm audit reports zero vulnerabilities. Excalidraw's old Sass dependency retained Chokidar 3 and `braces`, affected by [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). No patched `braces` release was available. Pinning Sass to the 1.105.1 version already used by Vite removes that watcher chain, with no Excalidraw downgrade. The lockfile records the replacement; build and drawing regressions verify compatibility.

RustSec reports zero vulnerability-class advisories, plus two informational lockfile warnings: unmaintained `proc-macro-error` (RUSTSEC-2024-0370) and unsound `glib` (RUSTSEC-2024-0429). Neither occurs in the Windows normal/build dependency graph, checked with `cargo tree --target x86_64-pc-windows-msvc --edges normal,build`. Their upstream Linux/GTK dependency chain remains a limitation if Linux support is introduced; this is not a claim that the cross-platform lockfile is warning-free.

The full application regression also exposed export-dialog focus ownership during [React StrictMode's effect replay](https://react.dev/reference/react/StrictMode). `Dialog` now owns its optional initial-focus target; board export supplies either the primary copy action or selectable code. Keyboard focus remains inside the dialog, cancellation restores the trigger, and clipboard failure still selects code for manual copying. Tests wait for the drawing engine's initial scene normalization and saved acknowledgement before asserting that exporting preserves the board. No layout, palette or motion behavior changes were needed.

Production regression checks also revealed test-environment assumptions. Oversized imports now exercise the visible file picker and error dialog in both builds. The mocked native-size notebook check is explicitly development-only because it intercepts a Vite source module; it still runs in development alongside the real native size tests. Reference context-menu checks explicitly dismiss the browser-owned menu before returning to editor keyboard selection.

The last full production run passed 233 checks, skipped 16 development-only checks and had one folder-menu timing failure. Keyboard helpers now assert editor focus and the selected text, and the folder test waits for activation, menu closure and the saved setting before reopening. All 24 repeated palette checks and all 27 repeated folder checks passed, covering the remaining applicable scenario. The verification JSON records full-run and rerun counts separately rather than claiming a failure-free full run.

## Repeatable validation

```powershell
npm run check:rust
npm run check:rust -- -Database
npm run build
npm test
powershell -NoProfile -File scripts/test-database.ps1
powershell -NoProfile -File scripts/test-native-rust-boundary.ps1
```

`check:rust` runs formatting, `cargo clippy --locked --all-targets -- -D warnings` and unit tests. `-Database` additionally starts the bundled runtime in a unique temporary profile, tests retained saves/conflicts/timeouts/restarts and server teardown, then removes only that profile. Release diagnostics use isolated database/WebView2 profiles and diagnostic startup names; they do not edit the user's notebook or normal sign-in registration. The standalone database diagnostic refuses nonempty profiles.

Final run results and installer identity are recorded in `release/rust-audit-verification-1.3.9.json`. Logs retain exact test output. Native successful/cancelled Save As dialogs and physical power-loss behavior remain outside automated coverage; file replacement and frontend cancellation/error handling are covered independently.
