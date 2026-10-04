"""Export generated Scribly masters at production display sizes, preserving alpha."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "branding"
PUBLIC = ROOT / "public"
NATIVE = ROOT / "src-tauri" / "icons"
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)

# One identical alpha mask is tinted by --accent in both themes. Three-times
# display resolution stays sharp at larger Windows DPI and app element sizes.
with Image.open(BRAND / "scribly-wordmark.png") as source:
    word = source.convert("RGBA")
    bounds = word.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()
    if not bounds:
        raise ValueError("Empty wordmark")
    # Include antialiased edges without retaining the generation's empty margins.
    left, top, right, bottom = bounds
    word = word.crop((left - 3, top - 3, right + 3, bottom + 3))
    word.thumbnail((324, 108), Image.Resampling.LANCZOS)
    mask = Image.new("RGBA", word.size, "white")
    mask.putalpha(word.getchannel("A"))
    mask.save(PUBLIC / "scribly-wordmark.webp", lossless=True, method=6)

sources = [Image.open(BRAND / name).convert("RGBA") for name in ("scribly-icon.png", "scribly-icon-dark.png")]
if any(image.width != image.height or image.getextrema()[3][0] != 0 for image in sources):
    raise ValueError("Icon masters must be square with genuine alpha transparency")
# Share the crop to prevent icon geometry changing on theme switches. Small
# near-transparent generation specks do not determine the visible tile bounds.
bounds = [image.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox() for image in sources]
left = min(b[0] for b in bounds); top = min(b[1] for b in bounds)
right = max(b[2] for b in bounds); bottom = max(b[3] for b in bounds)
side = max(right - left, bottom - top)
padding = round(side * .05)
cx, cy = (left + right) / 2, (top + bottom) / 2
crop = (round(cx - side / 2) - padding, round(cy - side / 2) - padding,
        round(cx - side / 2) + side + padding, round(cy - side / 2) + side + padding)

for image, suffix in zip(sources, ("", "-dark")):
    icon = image.crop(crop)
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(NATIVE / f"icon{suffix}.png", optimize=True)
    # The header does not load an icon. A small browser PNG serves the favicon;
    # standalone lossless WebPs are also provided for reuse and brand previews.
    icon.resize((64, 64), Image.Resampling.LANCZOS).save(PUBLIC / f"scribly-icon{suffix}.png", optimize=True)
    icon.resize((128, 128), Image.Resampling.LANCZOS).save(PUBLIC / f"scribly-icon{suffix}.webp", lossless=True, method=6)
    icon.save(BRAND / f"scribly{suffix}.ico", sizes=[(size, size) for size in SIZES])
    (NATIVE / f"icon{suffix}.ico").write_bytes((BRAND / f"scribly{suffix}.ico").read_bytes())

for path in sorted(PUBLIC.glob("scribly-*")):
    with Image.open(path) as image:
        assert image.mode == "RGBA" and image.getextrema()[3][0] == 0
        print(f"{path.name}: {image.width}x{image.height}, {path.stat().st_size:,} bytes")
for suffix in ("", "-dark"):
    path = NATIVE / f"icon{suffix}.ico"
    with Image.open(path) as image:
        assert image.ico.sizes() == {(size, size) for size in SIZES}
        for size in SIZES:
            assert image.ico.getimage((size, size)).getextrema()[3][0] == 0
    print(f"{path.name}: 10 resolutions, {path.stat().st_size:,} bytes")
