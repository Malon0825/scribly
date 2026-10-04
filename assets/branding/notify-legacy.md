# Notify app icon

The header displays only the generated brush wordmark. The app icon remains
available for the browser favicon and Windows window/shortcut. Header logo
derivatives from the earlier combined branding are retained here for reuse;
they are no longer requested by the header. The shared wordmark costs 6,954
bytes and is tinted by the theme's accent.
Only the display-size lossless transparent WebP derivatives in `public/` ship
to the header. Run `python scripts/create-header-branding.py` to rebuild them.
The wordmark is an alpha mask tinted with `--accent`, so one asset supports
both themes; the high-resolution PNG master is retained here for future edits.

Header payload sizes: light logo 80x80 / 6,666 bytes; dark logo 80x80 /
7,344 bytes; shared wordmark 276x108 / 6,954 bytes. Each theme initially uses
about 14 KB of header artwork. Intrinsic logo dimensions and fixed CSS mask
bounds prevent layout shifts. No new font download or image animation is used.

The header logo's tile is cropped to consistent visible bounds before export,
so generated transparent margins cannot shrink it relative to the lettering.
At medium UI size the icon is 32px square and the wordmark fits a 76x28px box,
with an 8px gap. Both scale together with the app's element-size preference.

## Brush wordmark generation prompt (built-in image generation)

Use case: logo-brand. Asset type: production transparent handwritten brush wordmark for the app Notify, to replace text in a compact desktop notebook header beside a separate N app icon. Create ONE original horizontal wordmark with exact text 'Notify' (capital N followed by lowercase o t i f y). Text ONLY, no icon or tile. Confident fluid brush-pen lettering, restrained human handwritten character, gently right-slanted, broad legible strokes with moderate thick/thin variation and softly rounded edges. A distinctive flowing N, open o, clear t crossbar and i dot, readable f and y. Keep every letter instantly legible at around 30px total height. Warm, calm and professional personal notebook brand; avoid childish lettering. One saturated blue #0879ff flat ink color, with only tiny subtle brush-edge irregularities; clean opaque main stroke coverage. No distressed holes or grain filling the letters. Horizontally compact balanced word shape, no long swashes or underline, no extra words, no glyph-like icons, no paint splatter, no pen, no shadow, no metallic/ribbon 3D, no gradient or glow. Center lettering on a wide horizontal canvas approximately 3:1 aspect ratio, closely framed with small consistent transparent margins, entire word including dot and descenders uncropped. Genuine transparent background, no checkerboard or solid background. Deliver just the Notify lettering, production-ready high-resolution raster.

The transparent master artwork is `notify-icon.png`. The Windows icon is
`notify.ico`, containing 16, 20, 24, 32, 40, 48, 64, 96, 128, and 256px images.
The same design is used for the desktop bundle and browser favicon.

The dark counterpart is `notify-icon-dark.png` and `notify-dark.ico`, with a
sand-colored N on charcoal to match the implemented dark theme. Both ICO files
contain the same ten resolutions. The browser favicon and running Windows
window icon follow the app's Light/Dark/System preference, including runtime
system changes. The installer and static Windows shortcut retain the light icon.
The native theme command updates both the small caption icon and large
taskbar/Alt+Tab icon. Four owned native handles (two sizes per theme) are loaded
once from embedded ICOs, reused on theme switches, and released on shutdown.
No browser canvas decoding or pixel transfer is needed for native updates.
`scripts/test-native-app-icon.ps1` verifies both Windows icon slots and their
pixel palettes in an isolated release WebView2, including rapid switches,
System preference changes, saved-theme reload, and cached-handle reuse.
The shell's rendered taskbar has not been visually inspected.

Generated with the built-in image generation tool. Run
`python scripts/create-icon.py` with Pillow installed to recreate the packaged
sizes from the master without generating new artwork.

## Generation prompt

Use case: logo-brand. Asset type: final Windows app icon for Notify, a calm personal writing notebook. Generate ONE new original icon, completely different from a blue tile with a white paper document. Creative direction: a distinctive custom gestural blue stroke suggesting a capital N for Notify, like a confident flowing handwritten pen gesture turned into a sculptural ink ribbon. Three connected movements form one legible N silhouette: upward left stroke, diagonal flowing connector, upward right stroke. Smooth rounded terminals, broad substantial variable-width stroke, controlled elegant curves, energetic but quiet. The connector has one subtle folded crossover or turn reminiscent of the flow of an idea; no separate objects. Avoid an ordinary typeset N. Keep the silhouette bold, simple and recognizable at 16px. Electric blue #0879ff, slightly darker blue on the small fold only. Center the blue gesture on a solid pale cool blue-gray #f0f5fb rounded-square tile, softly rounded corners about 22% radius; tile occupies 90% of canvas with transparent surrounding margin. Windows-native polished restrained physicality, nearly flat solid surfaces, very subtle edge highlight and recessed shadow only. Front facing, centered, square canvas. No white notebook, no document, no paper sheet, no ruled lines, no bell, no notification badge, no pencil, no wordmark or additional text, no generic typeface, no purple, no neon, no dramatic gradients, no glass, no glossy toy plastic, no external shadow, no mockup. Deliver the icon alone with genuine transparency outside the tile.

## Dark icon edit prompt (built-in image generation)

Edit target: the attached Notify app icon at the referenced path. Make a dark-mode counterpart matching a warm charcoal notebook app. Preserve exactly the existing flowing gestural capital N silhouette, stroke widths, curves, ribbon fold and crossover, placement, overall rounded square geometry, proportions, canvas dimensions, margin and transparent background. Change only the palette and its restrained material shading: pale tile becomes solid warm charcoal #272726 with an extremely subtle #33332f upper edge and fine gray #494944 rim. Electric-blue N becomes warm pale sand/champagne #e6c495 with gentle brighter #ebcea4 highlights; folded underside a deeper warm ochre/tan for legible depth. Quiet matte, crisp professional Windows app icon. Readable bold N at 16px, minimal physical depth, no metallic reflections, sparkle, glow, new ornaments, bells, text, backdrop, perspective or external drop shadow. Preserve genuine transparent pixels outside the rounded tile. Output just one square icon.
