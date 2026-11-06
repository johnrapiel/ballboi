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
