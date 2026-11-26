"""Draw the app icon (needs Pillow). Run once; the outputs are committed.

python packaging/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024


def draw() -> Image.Image:
    scale = SIZE / 36
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    # Rounded square with a darker lower edge, as on the buttons of the app.
    pen.rounded_rectangle(
        (1 * scale, 3 * scale, 35 * scale, 35 * scale),
        radius=11 * scale,
        fill="#1B7FCC",
    )
    pen.rounded_rectangle(
        (1 * scale, 1 * scale, 35 * scale, 32.500 * scale),
        radius=11 * scale,
        fill="#2EA8FF",
    )
    points = [(10, 23.500), (10, 11.500), (18, 17.500), (26, 11.500), (26, 23.500)]
    scaled = [(x * scale, y * scale) for x, y in points]
    pen.line(scaled, fill="#FFFFFF", width=int(3 * scale), joint="curve")
    radius = 1.500 * scale
    for x, y in (scaled[0], scaled[-1]):
        pen.ellipse((x - radius, y - radius, x + radius, y + radius), fill="#FFFFFF")
    return image


def main() -> None:
    image = draw()
    image.resize((256, 256), Image.LANCZOS).save(ROOT / "packaging" / "icon.png")
    image.save(
        ROOT / "packaging" / "icon.ico",
        sizes=[
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )


if __name__ == "__main__":
    main()
