"""Generates every raster asset from one vector description.

The launcher mark is drawn here so the PNG fallbacks for API 24-25 stay in
sync with res/drawable/ic_launcher_foreground.xml. Nothing is downloaded: the
shapes are the same coordinates used by the adaptive icon, scaled by size/108.
"""

from PIL import Image, ImageDraw

RED = (234, 43, 34, 255)
BODY = (193, 20, 13, 255)
WHITE = (255, 255, 255, 255)


def draw_mark(size: int) -> Image.Image:
    scale = size / 108.0
    image = Image.new("RGBA", (size, size), RED)
    draw = ImageDraw.Draw(image)

    def box(x0, y0, x1, y1):
        return [x0 * scale, y0 * scale, x1 * scale, y1 * scale]

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon(
        [(26 * scale, 62 * scale), (82 * scale, 62 * scale),
         (122 * scale, 102 * scale), (66 * scale, 102 * scale)],
        fill=(0, 0, 0, 46),
    )
    image.alpha_composite(shadow)

    draw.rounded_rectangle(box(26, 36, 82, 72), radius=14 * scale, fill=BODY)

    # D-pad
    draw.rectangle(box(38.6, 47.6, 43.4, 58.4), fill=WHITE)
    draw.rectangle(box(35.6, 50.6, 46.4, 55.4), fill=WHITE)
    # Action button
    draw.ellipse(box(60, 46, 74, 60), fill=WHITE)
    return image


def main() -> None:
    for size in (48, 72, 96, 144, 192, 512, 1024):
        name = f"mark-{size}.png" if size == 1024 else f"icon-{size}.png"
        draw_mark(size).save(name)
        print(name)


if __name__ == "__main__":
    main()
