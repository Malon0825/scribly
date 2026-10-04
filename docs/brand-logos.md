# Board brand logos

**Insert → Brand logos** in the board topbar opens the existing app Dialog with search, category filtering, virtual scrolling, grouped variants and batch insertion. Popular puts common architecture brands first; Recent remembers inserted brands, and category chips narrow results. The first matching brand is previewed automatically. Choose a variant/background and Add to selection, then Insert components; the picker stays open for more insertions. It remains accessible in Focus and is unavailable in archived/read-only boards. Escape, Done (Stop and close while busy) and backdrop dismissal restore the Insert control. Closing aborts further insertion; completed components remain in the drawing.

## Catalog and performance

The pinned `thesvg@3.3.12` package is a development dependency. `scripts/prepare-brand-logos.mjs` extracts static SVG files and metadata, rather than importing the entire icon barrel into the frontend. The checked/generated catalog has 7,387 icons and 12,077 variants. SVG artwork is 25,774,171 bytes on disk; this is install size, not startup memory. `npm run prepare:logos` regenerates it; prebuild prepares a missing catalog from the installed package. No CDN, remote logo query or CSP expansion is needed.

The catalog is fetched only when opening the picker. Search matches normalized title, slug, aliases and categories. Entries sharing a normalized title are grouped under one brand. Only viewport rows plus overscan are mounted; image previews load lazily. Closing releases catalog/index/selection state; recent insertions are remembered locally. Rasterization caps both decoding and output at 512 pixels on the long axis, revokes object URLs in `finally`, and retains proportions and colors. Repeated copies reuse a stable versioned file ID. Native RAM/frame latency still require measurement in Windows WebView2.

Reject executable SVG, external references, DTD/entities, animation and assets above 250 KB at generation/insertion. XML headers and comments are accepted. Twenty-three unsupported variants are excluded from this snapshot. Logos are rendered as PNG because notebook image validation and native storage intentionally accept raster formats. Paths remain artwork rather than editable vector shapes; the enclosing shape/label/group remain editable. This avoids introducing arbitrary SVG imports to note and backup validation.

## Saving and conversion

Insert a grouped rectangle, proportional logo image and bound text near the current viewport center, choosing a nearby free slot to avoid stacking components. The rectangle has existing architecture-component metadata and source/license/version brand metadata. Additions preflight board element/byte limits and total notebook capacity before mutating the engine. One immediate scene transaction supports Undo; existing gesture-aware autosave checkpoints the result. Original drawings are retained on load/render/capacity failure, with an error and retry. Cancellation never inserts after dismissal.

Arrows bind to the outer rectangle. Existing Mermaid conversion uses the bound label and preserves topology without embedding logo assets or referencing remote URLs. PNG/SVG exports preserve artwork; `.excalidraw` and notebook backups retain local image files. Reference remains a read-only static drawing.

## Design decisions

- Reuse Dialog, AppSelect, AnimatedIcon, solid panel/chrome/line/accent tokens and existing focus/press semantics. The catalog search inspected 21st's Icon Picker example; no component was copied because existing primitives fit.
- Keep the normal dialog dim layer, system typography and matching radii. Neutral/checkered preview backing keeps white variants visible and is not inserted artwork; the optional dark component background is an authoring choice. App chrome follows theme tokens.
- Reuse the existing short opacity entry and immediate dismissal. No additional spring, gesture, bounce, blur animation, editor remount or per-frame React work. Reduced motion removes dialog transitions and decorative icon movement.
- Retain keyboard search, category/variant selection, arrow-key browsing, Space/Enter queue toggling, focus trapping/return, Stop and close while busy and inline loading/empty/error states. Search uses one wrapper focus ring. Queued choices can be removed or cleared before insertion; batch errors report completed work without discarding it.

## Attribution

[theSVG source and documentation](https://github.com/glincker/thesvg) describe raw icon data and cloud collections. Code/tooling is MIT; individual marks retain their recorded licenses and trademarks. Source/license metadata is shown in preview and stored with each component. AWS artwork is identified as CC BY-ND 2.0. Full package notices ship in `BRAND-LOGO-LICENSES.txt`; per-icon metadata stays in `brand-logos/catalog.json`.

Historical validation results are recorded in `release/brand-logo-verification-1.3.7.json` after tests and packaging. That release's browser tests covered themed/narrow/Focus/reduced-motion geometry, bounded/lazy local search, insertion/Undo/reload/Mermaid/portable exports, catalog/artwork errors, dismissal during insertion and read-only behavior; they do not verify the follow-up controls. Current TypeScript/Vite build passed. Focused browser review observed 25 mounted logo tiles with AWS automatically previewed and successfully inserted two queued components, with no page errors. No new regression suite ran. Full keyboard/virtual-scroll/error-path coverage and native interactive behavior remain unverified.

The 21st code review reported three informational fixed-color findings. They apply to authored logo/component backgrounds and saved label colors, which intentionally remain stable when switching app themes. Dialog/controls use semantic theme tokens. No automatic fix was applied to recolor drawings.
