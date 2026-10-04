# Releasing Scribly

Publish free Windows downloads through [GitHub Releases](https://github.com/Malon0825/scribly/releases). Keep source code in Git and attach installers to releases. Contributors use forks and pull requests; ordinary users download the setup EXE without building the app.

## Version and validation

1. Update the version together in `package.json`, the root package entries in `package-lock.json`, `src-tauri/Cargo.toml`, the Scribly entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Use patch versions for fixes, minor versions for compatible features, and major versions for breaking changes.
2. Run `npm ci`, prepare PostgreSQL, and run `npm run package` on Windows x64. The production build generates the offline logo catalog. The packaging script bundles the database and its notices and copies the NSIS installer into `release/`.
3. Run applicable browser regressions against the production preview. Run `npm run check:rust`, `.\scripts\test-database.ps1`, and native diagnostics for changed desktop behavior. Verify a clean install and upgrade when available. Record what was tested and any limitations.
4. Review the staged source for credentials, personal data, generated output, and large files. Commit the tested source and release notes before tagging. Keep application identity/storage keys stable across updates.

## Publish

Create a versioned release note under `docs/releases/`, then compute a SHA-256 checksum for the final installer:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = "release/Scribly_${version}_x64-setup.exe"
$checksum = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$checksum  $(Split-Path $installer -Leaf)" | Set-Content -Encoding ascii release/SHA256SUMS-release.txt
git tag -a "v$version" -m "Scribly $version"
git push origin main "v$version"
gh release create "v$version" $installer release/SHA256SUMS-release.txt LICENSE --verify-tag --draft --title "Scribly $version" --notes-file "docs/releases/v$version.md"
```

Check that the tag points at the intended source and the uploaded assets match the local checksums. Publish the draft as the latest stable release only after validation. Use a prerelease for experimental builds, especially unverified persistence changes. Never replace an existing published installer silently: publish a new version.

## User-facing release information

Include Windows 10/11 x64 support, install/update instructions, the unsigned-installer warning, WebView2's possible first-install internet requirement, backup guidance, and relevant limitations. Attach the EXE directly; a RAR is unnecessary. GitHub supplies source archives automatically.

The current app has no automatic updater: users close Scribly and run the newer installer. Data stays under `%LOCALAPPDATA%\com.still.notes\database`. Export a portable backup before upgrades; do not copy a running PostgreSQL database as a backup.

MIT allows free use, contributions, redistribution, and commercial reuse with its notice retained. Bundled third-party materials retain their own licenses, and brand marks remain their owners' trademarks. The repository's MIT license does not replace those terms.

Code signing can improve publisher identification and Windows installation trust in future releases. Keep signing credentials out of the repository. This release is unsigned; do not describe it as signed or tell users to disable Windows protection.
