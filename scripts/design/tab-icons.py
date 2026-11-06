#!/usr/bin/env python3
"""Rasterise the approved Ball Boi brush tab icons (M/L/Z filled outlines on a 24 grid)
into iOS tab bar PNGs at 1x/2x/3x.
Run: python3 scripts/design/tab-icons.py docs/design-system/icons artifacts/mobile/assets/images/tabs
Unselected: inkMuted outline, Day and Night (rendered as original, not tinted).
Selected: painted ball fill + ink outline, in Day and Night ink."""
import re, sys, os
from PIL import Image, ImageDraw
SRC, OUT = sys.argv[1], sys.argv[2]
PT = 26           # icon box in points
SS = 8            # supersampling
INK = {"": (10, 36, 71), "-dark": (241, 230, 210)}
MUTED = {"": (74, 86, 112), "-dark": (184, 173, 155)}  # inkMuted, the unselected tab colour
NAVY = (10, 36, 71)
paint = Image.open(os.path.join(SRC, "ball-paint.png")).convert("RGB")

def paths(name):
    s = open(os.path.join(SRC, name + ".svg")).read()
    s = re.sub(r"<metadata>.*?</metadata>", "", s, flags=re.S)
    return re.findall(r'<path fill="([^"]+)" d="([^"]+)"', s)

def subpaths(d):
    out, cur = [], []
    for cmd, nums in re.findall(r"([MLZ])([^MLZ]*)", d):
        if cmd == "M":
            if cur: out.append(cur)
            cur = []
        if cmd in "ML":
            v = [float(x) for x in re.findall(r"-?\d*\.?\d+", nums)]
            cur += list(zip(v[0::2], v[1::2]))
        if cmd == "Z" and cur:
            out.append(cur); cur = []
    if cur: out.append(cur)
    return out

def mask(d, px):
    big = px * SS; k = big / 24.0
    m = Image.new("L", (big, big), 0); dr = ImageDraw.Draw(m)
    for sp in subpaths(d):
        if len(sp) > 2: dr.polygon([(x * k, y * k) for x, y in sp], fill=255)
    return m.resize((px, px), Image.LANCZOS)

def render(name, px, ink, template):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    for fill, d in paths(name):
        m = mask(d, px)
        if template:
            layer = Image.new("RGBA", (px, px), template + (255,))
        elif fill.startswith("url("):
            layer = paint.resize((px, px), Image.LANCZOS).convert("RGBA")
        elif fill == "currentColor":
            layer = Image.new("RGBA", (px, px), ink + (255,))
        else:
            layer = Image.new("RGBA", (px, px), NAVY + (255,))
        img.alpha_composite(Image.composite(layer, Image.new("RGBA", (px, px), (0,0,0,0)), m))
    return img

os.makedirs(OUT, exist_ok=True)
for tab in ["home", "leagues", "discover", "profile"]:
    for sc in (1, 2, 3):
        suf = "" if sc == 1 else f"@{sc}x"
        px = PT * sc
        for mode, ink in INK.items():
            render(tab, px, ink, MUTED[mode]).save(os.path.join(OUT, f"tab-{tab}{mode}{suf}.png"))
            render(tab + "-on", px, ink, None).save(os.path.join(OUT, f"tab-{tab}-on{mode}{suf}.png"))
print("ok")

# The Ball Boi tab keeps the logo ball (John, Nov 5), drawn by the same rule
# as the other tabs (finding 13, Nov 6): unselected, its strokes in the muted
# ink with no fill; selected, the painted ball's paint under the ink strokes.
# Source: the logo ball PNGs in the icons folder (navy strokes over the paint),
# split into strokes and paint by how dark each pixel is.
def ball(src, ink, muted, selected):
    im = Image.open(src).convert("RGBA")
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    lo, hi = lum(NAVY), 170.0  # navy strokes, and the darkest of the paint
    px, po = im.load(), out.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            w = max(0.0, min(1.0, (hi - lum((r, g, b))) / (hi - lo)))  # 1 = stroke, 0 = paint
            if not selected:
                po[x, y] = muted + (round(a * w),)
            else:
                pr, pg, pb = (r, g, b) if w < 1 else (0, 0, 0)
                c = tuple(round(ink[i] * w + ((pr, pg, pb)[i] if w < 1 else 0) * (1 - w)) for i in range(3))
                po[x, y] = c + (a,)
    return out

for sc in (1, 2, 3):
    suf = "" if sc == 1 else f"@{sc}x"
    src = os.path.join(SRC, f"ballboi{suf}.png")
    for mode, ink in INK.items():
        ball(src, ink, MUTED[mode], False).save(os.path.join(OUT, f"tab-ballboi{mode}{suf}.png"))
        ball(src, ink, MUTED[mode], True).save(os.path.join(OUT, f"tab-ballboi-on{mode}{suf}.png"))
print("ok, ball")
