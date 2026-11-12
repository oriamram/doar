"""Builds every icon and logo picture from the one master photo of the envelope.

The master is design/logo/envelope.png (the envelope on a transparent background).
Run it again after changing the master or the numbers below:

    python scripts/make-icons.py

Needs Python with Pillow (pip install pillow).
"""

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

# The red card under the envelope: --ink-red, which is also the manifest's theme_color.
RED = (166, 58, 38)
SHADOW = (48, 10, 2)
# Icons are composed at this size and scaled down, so small ones come out smooth.
WORK = 1024


def load_envelope() -> Image.Image:
    picture = Image.open(ROOT / "design" / "logo" / "envelope.png").convert("RGBA")
    box = picture.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return picture.crop(box)


ENVELOPE = load_envelope()


def shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel * factor))) for channel in color)


def red_card(size: int) -> Image.Image:
    """The card the envelope lies on: lit softly from the top-left, with a fine paper grain."""
    small = 64
    light = Image.new("L", (small, small))
    pixels = light.load()
    farthest = math.hypot(1 - 0.3, 1 - 0.24)
    for y in range(small):
        for x in range(small):
            distance = math.hypot(x / small - 0.3, y / small - 0.24) / farthest
            pixels[x, y] = round(255 * (1 - distance))
    light = light.resize((size, size), Image.BICUBIC)
    card = Image.composite(
        Image.new("RGB", (size, size), shade(RED, 1.1)),
        Image.new("RGB", (size, size), shade(RED, 0.84)),
        light,
    )
    grain = Image.effect_noise((size, size), 5)
    return ImageChops.add(card, Image.merge("RGB", (grain, grain, grain)), 1, -128).convert("RGBA")


def placed(size: int, width: float) -> Image.Image:
    """The envelope alone on a clear square, `width` being its share of the square's side."""
    w = round(size * width)
    h = round(w * ENVELOPE.height / ENVELOPE.width)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.alpha_composite(ENVELOPE.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return layer


def shadows(layer: Image.Image) -> Image.Image:
    """A wide soft shadow and a tight one right under the paper; the light is at the top-left."""
    size = layer.width
    alpha = layer.getchannel("A")
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    for blur, dx, dy, strength in ((0.04, 0.006, 0.02, 0.5), (0.007, 0.002, 0.005, 0.4)):
        moved = ImageChops.offset(alpha, round(dx * size), round(dy * size))
        soft = moved.filter(ImageFilter.GaussianBlur(blur * size)).point(lambda v, s=strength: round(v * s))
        shadow = Image.new("RGBA", layer.size, SHADOW + (255,))
        shadow.putalpha(soft)
        out.alpha_composite(shadow)
    return out


def on_card(width: float, size: int = WORK) -> Image.Image:
    """The whole icon, edge to edge: red card, shadows, envelope."""
    envelope = placed(size, width)
    icon = red_card(size)
    icon.alpha_composite(shadows(envelope))
    icon.alpha_composite(envelope)
    return icon


def floating(width: float, size: int = WORK) -> Image.Image:
    """The envelope with its shadows and nothing behind it (Android draws the red itself)."""
    envelope = placed(size, width)
    out = shadows(envelope)
    out.alpha_composite(envelope)
    return out


def cut(icon: Image.Image, corner: float) -> Image.Image:
    """Round the corners (0.5 makes a circle). Drawn four times larger so the edge is smooth."""
    size = icon.width
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * corner), fill=255)
    out = icon.copy()
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


def scaled(icon: Image.Image, size: int) -> Image.Image:
    small = icon.resize((size, size), Image.LANCZOS)
    # Tiny icons lose their edges when scaled down; put a little of them back.
    return small.filter(ImageFilter.UnsharpMask(radius=0.6, percent=70, threshold=0)) if size <= 64 else small


def save(icon: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    icon.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)}  {icon.width}x{icon.height}  {path.stat().st_size // 1024} KB")


def main() -> None:
    tile = cut(on_card(0.78), 0.225)  # the app icon: a red tile with rounded corners
    tight = cut(on_card(0.86), 0.225)  # the same, with a larger envelope, for very small sizes
    full = on_card(0.6)  # edge to edge; phones cut their own shape out of it

    # The web app (see the manifest in vite.config.ts, and index.html).
    save(scaled(tile, 512), PUBLIC / "pwa-512x512.png")
    save(scaled(tile, 192), PUBLIC / "pwa-192x192.png")
    save(scaled(tight, 64), PUBLIC / "pwa-64x64.png")
    save(scaled(full, 512), PUBLIC / "maskable-icon-512x512.png")
    save(scaled(on_card(0.76), 180).convert("RGB"), PUBLIC / "apple-touch-icon-180x180.png")
    scaled(tight, 256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("public/favicon.ico  16, 32, 48")

    # Inside the app the envelope lies straight on the desk; CSS gives it its shadow.
    for name, width in (("logo-envelope.webp", 720), ("logo-envelope-small.webp", 168)):
        height = round(width * ENVELOPE.height / ENVELOPE.width)
        picture = ENVELOPE.resize((width, height), Image.LANCZOS)
        picture.save(PUBLIC / name, quality=90, method=6)
        print(f"public/{name}  {width}x{height}  {(PUBLIC / name).stat().st_size // 1024} KB")

    # The Android app's launcher icons (the red behind them is a color in
    # res/values/ic_launcher_background.xml).
    if ANDROID_RES.exists():
        circle = cut(full, 0.5)
        layer = floating(0.46)
        for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
            folder = ANDROID_RES / f"mipmap-{density}"
            save(scaled(tile, size), folder / "ic_launcher.png")
            save(scaled(circle, size), folder / "ic_launcher_round.png")
            save(layer.resize((size * 108 // 48,) * 2, Image.LANCZOS), folder / "ic_launcher_foreground.png")


if __name__ == "__main__":
    main()
