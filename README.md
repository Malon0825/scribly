# Scribly

A free Windows notebook for writing, keeping a second note in view, and sketching architecture boards. Your notebook stays on your computer; no account or cloud service is required.

**[Download the latest Windows release](https://github.com/Malon0825/scribly/releases/latest)** · [User guide](docs/user-guide.md) · [Contribute](CONTRIBUTING.md) · [Report a bug](https://github.com/Malon0825/scribly/issues)

## Install

1. Open the [latest release](https://github.com/Malon0825/scribly/releases/latest) and download `Scribly_1.3.11_x64-setup.exe` from **Assets**. The source ZIP is for developers.
2. Run the setup EXE. Scribly installs for your Windows account without administrator access.
3. Open Scribly from the Start menu.

Supports **Windows 10/11 x64**. Microsoft WebView2 is required; setup downloads it from Microsoft if it is missing, so first installation may need internet access. PostgreSQL is bundled: you do not need to install or configure a database.

The installer is **unsigned**. Windows may show an unknown-publisher or SmartScreen warning. Download from this repository's release page and use the supplied SHA-256 checksum to verify the file. Do not disable Windows protection.

To update, export a backup in Settings, close Scribly, and run the newer installer. Existing notebooks are retained. There is no automatic updater in this version.

## What you can do

- Organize notes in folders, search, reorder, move, archive, and duplicate them.
- Write rich text, code blocks, checklists, and notes with embedded images, selected-text colors, marker strokes, and pen drawing.
- Keep a read-only note or board visible in Reference, or use Focus mode for more writing space.
- Create Excalidraw boards, insert offline brand logos, import Mermaid, and export drawings, SVG, PNG, or Mermaid. Copy flowcharts for Miro.
- Import text, Markdown, code, selectable-text PDFs, and Word `.docx` files.
- Choose Light, Dark, or System appearance and adjust interface size and note typography.
- Autosave locally and export/import portable notebook backups.

See the [user guide](docs/user-guide.md) for shortcuts and feature limits. [Version 1.3.11](docs/releases/v1.3.11.md) improves the running Windows taskbar icon's resolution while retaining theme-aware icons.

## Your data

The desktop app stores notes under `%LOCALAPPDATA%\com.still.notes\database`. Its bundled PostgreSQL server listens only on loopback, uses a random local port and an app-generated password, and stops when the app exits. Updates and uninstalling preserve the notebook folder. Export backups periodically from Settings; copying a live PostgreSQL folder is not a supported backup method.

Scribly is currently a personal notebook with **no cloud sync or shared editing**. The browser development preview uses browser local storage and is separate from your desktop notebook.

## Develop

For the browser preview, install Node.js **22.12+**:

```powershell
npm ci
npm run prepare:logos
npm run dev
```

Open `http://127.0.0.1:1420`. For the Windows app, also install Rust stable, Visual Studio C++ build tools, a Windows SDK, and WebView2:

```powershell
.\scripts\prepare-postgres.ps1
npm run tauri -- dev
```

Build an installer with `npm run package`. Run `npm run build` for the production frontend and `npm run check:rust` for native checks. Playwright tests are in `tests/`; install Chromium with `npx playwright install chromium` and run the relevant tests with `npm test`. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull requests, and validation, and [release guidance](docs/releasing.md) for publishing.

## Contribute and license

Contributions are welcome through [issues](https://github.com/Malon0825/scribly/issues) and pull requests: bug fixes, documentation, accessibility, testing, and thoughtful improvements all help. Fork the repository and submit a focused change against `main`; see [CONTRIBUTING.md](CONTRIBUTING.md).

Scribly is free and open source under the [MIT license](LICENSE). You can use, modify, and redistribute it, including commercially, while retaining the license notice. Bundled dependencies, fonts, and artwork retain their own licenses. See [native notices](src-tauri/resources/THIRD-PARTY-NOTICES.txt) and the `public/*-licenses.txt` files. Brand marks remain the trademarks of their owners.
