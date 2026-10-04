"""Package the generated Notify artwork into browser and Windows icon assets."""
from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parent.parent
branding = project / "assets" / "branding"
icons = project / "src-tauri" / "icons"
public = project / "public"
icons.mkdir(exist_ok=True)
public.mkdir(exist_ok=True)

for suffix in ("", "-dark"):
    with Image.open(branding / f"notify-icon{suffix}.png") as source:
        image = source.convert("RGBA")
        if image.width != image.height:
            raise ValueError("The icon source must be square.")
        if image.getextrema()[3][0] != 0:
            raise ValueError("The icon source must preserve a transparent background.")
        image.resize((512, 512), Image.Resampling.LANCZOS).save(icons / f"icon{suffix}.png")
        image.resize((256, 256), Image.Resampling.LANCZOS).save(public / f"notify-icon{suffix}.png")
        image.save(
            branding / f"notify{suffix}.ico",
            sizes=[(size, size) for size in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)],
        )
        (icons / f"icon{suffix}.ico").write_bytes((branding / f"notify{suffix}.ico").read_bytes())

print("Packaged light/dark Notify PNGs and Windows ICOs (16-256px, 10 resolutions each).")
