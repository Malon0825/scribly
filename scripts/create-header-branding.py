"""Package header artwork at display-appropriate resolutions; preserve transparency."""
from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parent.parent
branding = project / "assets" / "branding"
public = project / "public"
public.mkdir(exist_ok=True)

for theme, suffix in (("light", ""), ("dark", "-dark")):
    with Image.open(branding / f"notify-icon{suffix}.png") as source:
        image = source.convert("RGBA")
        # Normalize the visible tile, rather than sizing its generated empty canvas.
        # Ignore stray near-transparent edge pixels when locating the artwork.
        bounds = image.getchannel("A").point(lambda alpha: 255 if alpha > 128 else 0).getbbox()
        if not bounds:
            raise ValueError("App logo artwork is empty.")
        left, top, right, bottom = bounds
        side = max(right - left, bottom - top) + 4
        center_x, center_y = (left + right) / 2, (top + bottom) / 2
        image = image.crop((round(center_x - side / 2), round(center_y - side / 2),
                            round(center_x + side / 2), round(center_y + side / 2)))
        image.resize((80, 80), Image.Resampling.LANCZOS).save(
            public / f"notify-logo-{theme}.webp", lossless=True, method=6,
        )

with Image.open(branding / "notify-wordmark.png") as source:
    image = source.convert("RGBA")
    # Trim empty generation margins so the word is readable at header size.
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("Wordmark artwork is empty.")
    image = image.crop(bounds)
    image.thumbnail((324, 108), Image.Resampling.LANCZOS)
    # Only alpha is used by the CSS mask; a solid RGB plane compresses cheaply.
    mask = Image.new("RGBA", image.size, "white")
    mask.putalpha(image.getchannel("A"))
    mask.save(public / "notify-wordmark.webp", lossless=True, method=6)

for name in ("notify-logo-light.webp", "notify-logo-dark.webp", "notify-wordmark.webp"):
    path = public / name
    with Image.open(path) as image:
        assert image.getextrema()[3][0] == 0
        print(f"{name}: {image.width}x{image.height}, {path.stat().st_size:,} bytes")
