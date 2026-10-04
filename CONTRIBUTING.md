# Contributing to Scribly

Bug reports, documentation, accessibility improvements, tests, and code contributions are welcome. Scribly is a personal Windows notebook built with React 19, TypeScript, Tiptap 3, Tauri 2, Rust, and bundled PostgreSQL.

## Report a bug or propose a feature

Use [GitHub Issues](https://github.com/Malon0825/scribly/issues). For a bug, include the Scribly version, Windows version, steps to reproduce, expected and actual behavior, and whether it happens in the desktop app or browser preview. Use sample notes and remove personal information from screenshots, logs, and attachments. Discuss substantial changes in an issue before starting implementation.

## Run the browser preview

Install Node.js 22.12 or newer, fork the repository, and clone your fork. From the project root:

```powershell
npm ci
npm run prepare:logos
npm run dev
```

Open `http://127.0.0.1:1420`. The preview uses browser local storage and needs neither Rust nor PostgreSQL. `npm ci` also applies the pinned Excalidraw patch; do not skip install scripts.

## Run the Windows desktop app

Install Rust stable for `x86_64-pc-windows-msvc`, Visual Studio C++ build tools, a Windows SDK, and Microsoft WebView2. Then:

```powershell
.\scripts\prepare-postgres.ps1
npm run tauri -- dev
```

The preparation script downloads PostgreSQL from EDB. The database runtime, build tools, generated assets, local profiles, and installers are ignored by Git. Keep the stable `com.still.notes` app identifier and storage keys to preserve existing notebooks.

## Submit a pull request

1. Create a branch in your fork for one focused change.
2. Read [AGENTS.md](AGENTS.md) and the relevant implementation. Preserve editor selection, keyboard access, read-only Reference behavior, and truthful save/error feedback.
3. Run `npm run build`. For behavior changes, run the applicable Playwright tests after `npx playwright install chromium`; use `npm test -- tests/<name>.spec.ts`. For native changes, run `npm run check:rust` on Windows with the prepared PostgreSQL resources. Run `.\scripts\check-rust.ps1 -Database` when persistence behavior changes.
4. For UI work, check light/dark/System themes, reduced motion, narrow/wide windows, and keyboard use. Identify native behavior you could not test.
5. Open a pull request against `main`. Explain the problem, resulting behavior, and validation; include screenshots when useful.

Never commit personal notebooks, database files, credentials, private keys, build output, or installers. Update the existing lockfiles deliberately; avoid unrelated dependency upgrades.

## License

By submitting a contribution, you agree that your contribution is provided under this project's [MIT license](LICENSE). Third-party code, fonts, and brand marks retain their original licenses and notices. Be respectful in issues and reviews; maintainers decide which changes to accept.
