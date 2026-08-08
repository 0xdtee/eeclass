# -*- coding: utf-8 -*-
"""Generate the add-in icons (for the Word ribbon buttons). Only needs to run once at install time."""
import os
from PIL import Image, ImageDraw

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "addin", "assets"))
BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)


def make(size):
    # supersample at 4x then shrink, so the edges stay free of jaggies
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, s - 1, s - 1], fill=BLUE)

    # microphone body
    w, h = s * 0.22, s * 0.40
    x0, y0 = (s - w) / 2, s * 0.20
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=w / 2, fill=WHITE)

    # curved cradle at the bottom
    lw = max(2, int(s * 0.055))
    pad = s * 0.28
    d.arc([pad, s * 0.34, s - pad, s * 0.74], start=0, end=180, fill=WHITE, width=lw)

    # stand
    d.line([s / 2, s * 0.68, s / 2, s * 0.80], fill=WHITE, width=lw)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for n in (16, 32, 64, 80):
        p = os.path.join(OUT, f"icon-{n}.png")
        make(n).save(p)
        print("写入", p)


if __name__ == "__main__":
    main()
