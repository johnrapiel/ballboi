#!/usr/bin/env python3
"""Draw Ball Boi's brush icon set: every icon in the app outside the tab bar.

John, Nov 7, 2026: every icon in the app is hand-drawn, matching the brush tab
icons (docs/design-system/icons). No SF Symbols or line icon sets.

Each icon is a few centre-line strokes on a 24 grid. Each stroke becomes a
filled brush mark: tapered, rounded ends, a little width change and wobble
along its length, like the tab icons. Randomness is seeded by the icon's name,
so re-running the script gives the same drawings.

Run from the repo root:
  python3 scripts/design/brush-icons.py
Writes:
  artifacts/mobile/components/icons/brushPaths.ts   (what the app draws)
  docs/design-system/icons/ui/<name>.svg            (sources, currentColor)

To add an icon: add a function to ICONS below, re-run, and use
<Icon name="..."> in the app. Never import SF Symbols or an icon library.
"""
import math, os, random, json

W = 1.9          # stroke width on the 24 grid at its widest (tab icons match)
STEP = 0.6      # sample spacing along a stroke

# ---------- centre-line primitives (lists of points) ----------

def L(x0, y0, x1, y1):
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) / STEP) + 1)
    return [(x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)) for i in range(n)]

def E(cx, cy, rx, ry, a0, a1):
    """Elliptical arc, degrees, y down (90 = bottom, 270 = top)."""
    span = math.radians(a1 - a0)
    n = max(3, int(abs(span) * max(rx, ry) / STEP) + 1)
    return [(cx + rx * math.cos(math.radians(a0) + span * i / (n - 1)),
             cy + ry * math.sin(math.radians(a0) + span * i / (n - 1))) for i in range(n)]

def A(cx, cy, r, a0, a1):
    return E(cx, cy, r, r, a0, a1)

def C(p0, p1, p2, p3):
    pts = []
    for i in range(41):
        t = i / 40
        pts.append(tuple((1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k] for k in (0, 1)))
    return resample(pts)

def resample(pts):
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += math.hypot(b[0] - a[0], b[1] - a[1])
        if acc >= STEP:
            out.append(b); acc = 0.0
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out

def RING(cx=12, cy=12, r=9, start=110):
    """A hand-drawn circle: one stroke with a small open gap, like the tab icons."""
    return A(cx, cy, r, start, start + 340)

# ---------- brush rendering ----------

class Pen:
    def __init__(self, name):
        self.rnd = random.Random(name)
        self.shapes = []

    def stroke(self, pts, w=1.0):
        r = self.rnd
        n = len(pts)
        width = W * w
        f1, f2 = r.uniform(0.6, 1.4), r.uniform(1.5, 2.6)
        p1, p2, p3 = r.uniform(0, 6.3), r.uniform(0, 6.3), r.uniform(0, 6.3)
        start_t, end_t = r.uniform(0.6, 0.75), r.uniform(0.65, 0.85)
        length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        wob = min(0.13, 0.03 * length)
        left, right, half = [], [], []
        for i, (x, y) in enumerate(pts):
            t = i / (n - 1)
            a = pts[max(0, i - 1)]; b = pts[min(n - 1, i + 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            d = math.hypot(dx, dy) or 1
            nx, ny = -dy / d, dx / d
            taper = 1.0
            if t < 0.2: taper = start_t + (1 - start_t) * math.sin(t / 0.2 * math.pi / 2)
            if t > 0.8: taper = min(taper, end_t + (1 - end_t) * math.cos((t - 0.8) / 0.2 * math.pi / 2))
            hw = width / 2 * taper * (1 + 0.07 * math.sin(2 * math.pi * f2 * t + p2))
            off = wob * math.sin(2 * math.pi * f1 * t + p1) * math.sin(math.pi * t)
            cx, cy = x + nx * off, y + ny * off
            left.append((cx + nx * hw, cy + ny * hw))
            right.append((cx - nx * hw, cy - ny * hw))
            half.append(hw)
        poly = left[:]
        poly += cap(pts[-1], pts[-2], half[-1])
        poly += right[::-1]
        poly += cap(pts[0], pts[1], half[0])
        self.shapes.append(poly)

    def dot(self, cx, cy, r):
        rnd = self.rnd
        ph = rnd.uniform(0, 6.3)
        pts = []
        for i in range(24):
            a = 2 * math.pi * i / 24
            rr = r * (1 + 0.07 * math.sin(2 * a + ph))
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.shapes.append(pts)

    def blob(self, poly):
        """A filled, slightly uneven painted shape (corners as given)."""
        rnd = self.rnd
        pts = []
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            seg = L(x0, y0, x1, y1)[:-1]
            for j, (x, y) in enumerate(seg):
                pts.append((x + rnd.uniform(-0.08, 0.08), y + rnd.uniform(-0.08, 0.08)))
        self.shapes.append(pts)

def cap(p, q, hw):
    """Round end cap at p, the stroke arriving from q."""
    ang = math.atan2(p[1] - q[1], p[0] - q[0])
    return [(p[0] + hw * math.cos(ang + math.pi / 2 - math.pi * k / 6),
             p[1] + hw * math.sin(ang + math.pi / 2 - math.pi * k / 6)) for k in range(1, 6)]

def area(poly):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1])) / 2

def to_path(shapes):
    parts = []
    for poly in shapes:
        if area(poly) < 0:  # one winding direction, so overlaps union under nonzero
            poly = poly[::-1]
        parts.append("M" + "L".join(f"{x:.1f} {y:.1f}".replace(".0 ", " ") for x, y in poly) + "Z")
    return "".join(parts)

# ---------- the set ----------

def ring(p, **k): p.stroke(RING(**k))

def calendar_small(p):
    # Calendar with its lower right corner left open for a badge.
    p.stroke(L(3.2, 5.8, 3.2, 17.4)); p.stroke(L(3.4, 17.6, 11.2, 17.6))
    p.stroke(L(3.2, 5.6, 16.6, 5.6)); p.stroke(L(16.8, 5.8, 16.8, 11))
    p.stroke(L(3.6, 9.4, 16.4, 9.4), 0.8)
    p.stroke(L(7, 3, 7, 6.6), 0.9); p.stroke(L(13, 3, 13, 6.6), 0.9)

def person(p, cx, top, r, shoulder_w, shoulder_y, a0=200, a1=340):
    p.stroke(RING(cx, top + r, r, start=100))
    p.stroke(E(cx, shoulder_y, shoulder_w, 4.6, a0, a1))

ICONS = {}
def icon(name, w=1.0):
    def deco(fn):
        ICONS[name] = (fn, w); return fn
    return deco

@icon("chevron.right")
def _(p): p.stroke(L(9, 5, 15.6, 12)); p.stroke(L(15.6, 12, 9, 19))

@icon("checkmark")
def _(p): p.stroke(L(4.3, 12.6, 9.4, 17.6)); p.stroke(L(9.4, 17.6, 19.8, 5.8))

@icon("xmark")
def _(p): p.stroke(L(6, 6, 18, 18)); p.stroke(L(18.2, 5.8, 5.8, 18.2))

@icon("plus")
def _(p): p.stroke(L(12, 4.3, 12, 19.7)); p.stroke(L(4.3, 12, 19.7, 12))

@icon("ellipsis")
def _(p): [p.dot(x, 12, 1.65) for x in (5, 12, 19)]

@icon("circle")
def _(p): ring(p)

def check_in(p, w=1.0): p.stroke(L(7.6, 12.4, 10.6, 15.4), w); p.stroke(L(10.6, 15.4, 16.4, 8.6), w)
def x_in(p): p.stroke(L(9, 9, 15, 15), 0.9); p.stroke(L(15, 9, 9, 15), 0.9)

@icon("checkmark.circle")
def _(p): ring(p); check_in(p)

@icon("checkmark.circle.fill")
def _(p): ring(p); check_in(p, 1.2)  # selected radio: the check, drawn heavier

@icon("xmark.circle")
def _(p): ring(p); x_in(p)

@icon("xmark.circle.fill")
def _(p): ring(p); x_in(p)

@icon("plus.circle")
def _(p): ring(p); p.stroke(L(12, 7.6, 12, 16.4), 0.9); p.stroke(L(7.6, 12, 16.4, 12), 0.9)

@icon("minus.circle")
def _(p): ring(p); p.stroke(L(7.6, 12, 16.4, 12), 0.9)

@icon("info.circle")
def _(p): ring(p); p.dot(12, 7.9, 1.2); p.stroke(L(12, 11, 12, 16.6), 0.9)

@icon("exclamationmark.circle")
def _(p): ring(p); p.stroke(L(12, 6.8, 12, 12.8), 0.9); p.dot(12, 16.4, 1.2)

@icon("questionmark.circle")
def _(p):
    ring(p)
    p.stroke(C((9.3, 9.6), (9.3, 6.4), (14.7, 6.4), (14.7, 9.3)), 0.85)
    p.stroke(C((14.7, 9.3), (14.7, 11.3), (12, 11.2), (12, 13.4)), 0.85)
    p.dot(12, 16.7, 1.15)

@icon("pause.circle")
def _(p): ring(p); p.stroke(L(9.8, 8.4, 9.8, 15.6), 0.9); p.stroke(L(14.2, 8.4, 14.2, 15.6), 0.9)

@icon("record.circle")
def _(p): ring(p); p.dot(12, 12, 4.4)

@icon("arrow.up.circle")
def _(p):
    ring(p); p.stroke(L(12, 16.6, 12, 7.6), 0.9)
    p.stroke(L(8.2, 11.2, 12, 7.3), 0.9); p.stroke(L(15.8, 11.2, 12, 7.3), 0.9)

@icon("clock")
def _(p): ring(p); p.stroke(L(12, 6.8, 12, 12.4), 0.9); p.stroke(L(12, 12.4, 15.6, 14.6), 0.9)

@icon("exclamationmark.triangle")
def _(p):
    p.stroke(L(12, 3.4, 2.7, 19.9)); p.stroke(L(12, 3.4, 21.3, 19.9)); p.stroke(L(2.6, 20.1, 21.4, 20.1))
    p.stroke(L(12, 9.2, 12, 14), 0.9); p.dot(12, 16.9, 1.1)

@icon("calendar")
def _(p):
    p.stroke(L(3.8, 6.2, 3.8, 20)); p.stroke(L(20.2, 6.2, 20.2, 20)); p.stroke(L(4, 20.2, 20, 20.2))
    p.stroke(L(3.8, 5.8, 20.2, 5.8)); p.stroke(L(4.2, 10.2, 19.8, 10.2), 0.8)
    p.stroke(L(8, 3, 8, 7), 0.9); p.stroke(L(16, 3, 16, 7), 0.9)

@icon("square.grid.3x3")
def _(p):
    # Free times (John, Nov 8): the week's hour grid, a hand-drawn square cut
    # into three by three, as on the canvas's player card.
    p.stroke(L(4.6, 4.4, 19.4, 4.6)); p.stroke(L(19.5, 4.8, 19.6, 19.4))
    p.stroke(L(19.4, 19.6, 4.6, 19.5)); p.stroke(L(4.4, 19.4, 4.5, 4.6))
    p.stroke(L(9.6, 4.8, 9.5, 19.2), 0.8); p.stroke(L(14.5, 4.8, 14.6, 19.2), 0.8)
    p.stroke(L(4.8, 9.5, 19.2, 9.4), 0.8); p.stroke(L(4.8, 14.5, 19.2, 14.6), 0.8)

@icon("calendar.badge.clock")
def _(p):
    calendar_small(p); p.stroke(RING(17.4, 17.4, 4.6, start=200), 0.85)
    p.stroke(L(17.4, 14.8, 17.4, 17.6), 0.75); p.stroke(L(17.4, 17.6, 19.2, 18.6), 0.75)

@icon("calendar.badge.plus")
def _(p):
    calendar_small(p); p.stroke(L(17.4, 12.4, 17.4, 21.6), 0.95); p.stroke(L(12.8, 17, 22, 17), 0.95)

@icon("calendar.badge.checkmark")
def _(p):
    calendar_small(p); p.stroke(L(12.6, 17.2, 15.6, 20.2), 0.95); p.stroke(L(15.6, 20.2, 21.6, 13), 0.95)

@icon("hourglass")
def _(p):
    p.stroke(L(5.6, 3.4, 18.4, 3.4)); p.stroke(L(5.6, 20.6, 18.4, 20.6))
    p.stroke(C((7.4, 3.8), (7.4, 9), (11.6, 10.4), (12, 12)), 0.9); p.stroke(C((16.6, 3.8), (16.6, 9), (12.4, 10.4), (12, 12)), 0.9)
    p.stroke(C((12, 12), (11.6, 13.6), (7.4, 15), (7.4, 20.2)), 0.9); p.stroke(C((12, 12), (12.4, 13.6), (16.6, 15), (16.6, 20.2)), 0.9)
    p.blob([(9.2, 19.6), (14.8, 19.6), (12, 16.6)])

@icon("mappin.and.ellipse")
def _(p):
    p.stroke(A(12, 8.6, 5.4, 138, 402))
    p.stroke(L(7.99, 12.21, 12, 18.4)); p.stroke(L(16.01, 12.21, 12, 18.4))
    p.dot(12, 8.6, 1.7)
    p.stroke(E(12, 19.4, 8.4, 2.5, -15, 195), 0.8)

@icon("flag.checkered")
def _(p):
    p.stroke(L(5, 3.4, 5, 21))
    p.stroke(C((5.2, 4.6), (9, 2.8), (13.4, 6.4), (19.2, 4.6)), 0.9)
    p.stroke(L(19.2, 4.6, 19.2, 13), 0.9)
    p.stroke(C((5.2, 13), (9, 11.2), (13.4, 14.8), (19.2, 13)), 0.9)
    p.blob([(5.4, 5), (12, 5.2), (12, 9), (5.4, 9)])
    p.blob([(12, 9), (18.8, 8.6), (18.8, 12.6), (12, 12.6)])

@icon("sportscourt")
def _(p):
    p.stroke(L(2.8, 6, 21.2, 6), 0.85); p.stroke(L(2.8, 18, 21.2, 18), 0.85)
    p.stroke(L(2.8, 5.8, 2.8, 18.2), 0.85); p.stroke(L(21.2, 5.8, 21.2, 18.2), 0.85)
    p.stroke(L(12, 4.4, 12, 19.6), 0.95)
    p.stroke(L(7.4, 6.4, 7.4, 17.6), 0.65); p.stroke(L(16.6, 6.4, 16.6, 17.6), 0.65)

@icon("person.2")
def _(p):
    person(p, 9, 4, 3.4, 6.2, 20.4)
    p.stroke(A(16.4, 7.8, 2.9, 250, 470), 0.85)
    p.stroke(E(16.6, 18.4, 5, 4.4, 250, 345), 0.85)

@icon("person.3.fill")
def _(p):
    person(p, 12, 4.6, 3.1, 5.8, 21)
    p.stroke(A(5.2, 9.6, 2.3, 120, 300), 0.8); p.stroke(E(4.8, 19, 3.4, 4.2, 200, 262), 0.8)
    p.stroke(A(18.8, 9.6, 2.3, 240, 420), 0.8); p.stroke(E(19.2, 19, 3.4, 4.2, 278, 340), 0.8)

@icon("pencil")
def _(p):
    p.stroke(L(6.2, 15.2, 15.8, 5.6)); p.stroke(L(8.8, 17.8, 18.4, 8.2))
    p.stroke(C((15.8, 5.6), (17, 4.2), (19.8, 7), (18.4, 8.2)))
    p.stroke(L(6.2, 15.2, 4.4, 19.6)); p.stroke(L(8.8, 17.8, 4.4, 19.6))
    p.stroke(L(13.8, 7.6, 16.4, 10.2), 0.75)

@icon("square.and.pencil")
def _(p):
    p.stroke(L(4, 7, 4, 20)); p.stroke(L(4.2, 20.2, 17, 20.2)); p.stroke(L(17.2, 20, 17.2, 13.6))
    p.stroke(L(4.2, 6.8, 10.6, 6.8))
    p.stroke(L(10.8, 11.4, 17.8, 4.4), 0.85); p.stroke(L(12.6, 13.2, 19.6, 6.2), 0.85)
    p.stroke(C((17.8, 4.4), (18.6, 3.6), (20.4, 5.4), (19.6, 6.2)), 0.85)
    p.stroke(L(10.8, 11.4, 9.4, 14.6), 0.85); p.stroke(L(12.6, 13.2, 9.4, 14.6), 0.85)

@icon("square.and.arrow.up")
def _(p):
    p.stroke(L(5, 10, 5, 20.2)); p.stroke(L(5.2, 20.4, 18.8, 20.4)); p.stroke(L(19, 20.2, 19, 10))
    p.stroke(L(5.2, 9.8, 8.4, 9.8), 0.9); p.stroke(L(15.6, 9.8, 18.8, 9.8), 0.9)
    p.stroke(L(12, 15.2, 12, 3.6)); p.stroke(L(8.2, 7.2, 12, 3.3)); p.stroke(L(15.8, 7.2, 12, 3.3))

@icon("doc.on.doc")
def _(p):
    p.stroke(L(8.6, 3.6, 18.4, 3.6), 0.85); p.stroke(L(18.6, 3.8, 18.6, 15.2), 0.85)
    p.stroke(L(4.6, 7.8, 14.4, 7.8)); p.stroke(L(14.6, 8, 14.6, 20.4)); p.stroke(L(14.4, 20.6, 4.6, 20.6)); p.stroke(L(4.4, 20.4, 4.4, 8))

@icon("trash")
def _(p):
    p.stroke(L(3.8, 6.4, 20.2, 6.4))
    p.stroke(L(9.4, 6, 9.8, 3.4), 0.8); p.stroke(L(14.6, 6, 14.2, 3.4), 0.8); p.stroke(L(9.8, 3.3, 14.2, 3.3), 0.8)
    p.stroke(L(6, 7, 7.2, 20.2)); p.stroke(L(18, 7, 16.8, 20.2)); p.stroke(L(7.2, 20.4, 16.8, 20.4))
    p.stroke(L(10, 10.2, 10.3, 16.8), 0.75); p.stroke(L(14, 10.2, 13.7, 16.8), 0.75)

def lock_shackle(p):
    p.stroke(A(12, 8.6, 4, 180, 360)); p.stroke(L(8, 8.6, 8, 11)); p.stroke(L(16, 8.6, 16, 11))

@icon("lock")
def _(p):
    lock_shackle(p)
    p.stroke(L(5, 11.2, 19, 11.2)); p.stroke(L(4.8, 11.4, 4.8, 20.4)); p.stroke(L(19.2, 11.4, 19.2, 20.4)); p.stroke(L(5, 20.6, 19, 20.6))
    p.dot(12, 15.8, 1.2)

@icon("lock.fill")
def _(p):
    lock_shackle(p)
    p.blob([(4.4, 10.6), (19.6, 10.4), (19.8, 21), (4.2, 21.2)])

@icon("envelope")
def _(p):
    p.stroke(L(3.4, 5.6, 20.6, 5.6)); p.stroke(L(3.2, 5.8, 3.2, 18.4)); p.stroke(L(20.8, 5.8, 20.8, 18.4)); p.stroke(L(3.4, 18.6, 20.6, 18.6))
    p.stroke(L(4, 6.6, 12, 13), 0.85); p.stroke(L(20, 6.6, 12, 13), 0.85)

@icon("message")
def _(p):
    p.stroke(E(12, 11, 8.8, 7.2, 152, 487))
    p.stroke(L(7.1, 17, 3.8, 20.6), 0.9); p.stroke(L(3.8, 20.6, 4.6, 14.5), 0.9)

@icon("magnifyingglass")
def _(p): p.stroke(RING(10.4, 10.4, 6.6, start=60)); p.stroke(L(15.2, 15.2, 20.6, 20.6), 1.1)

@icon("paperplane")
def _(p):
    p.stroke(L(3, 10.6, 20.8, 3.2)); p.stroke(L(20.8, 3.2, 13.6, 21)); p.stroke(L(13.6, 21, 10.8, 13.2))
    p.stroke(L(10.8, 13.2, 3, 10.6)); p.stroke(L(10.8, 13.2, 20.6, 3.4), 0.75)

@icon("eye.slash")
def _(p):
    p.stroke(C((2.4, 12), (6, 5.4), (18, 5.4), (21.6, 12)))
    p.stroke(C((2.4, 12), (6, 18.6), (18, 18.6), (21.6, 12)))
    p.stroke(RING(12, 12, 2.9, start=30), 0.85)
    p.stroke(L(4, 3.6, 20, 20.4))

def wifi_arcs(p):
    for r in (4.2, 8.4, 12.6):
        p.stroke(A(12, 18.6, r, 226, 314), 0.9 if r > 5 else 0.85)
    p.dot(12, 18.8, 1.4)

@icon("wifi")
def _(p): wifi_arcs(p)

@icon("wifi.slash")
def _(p): wifi_arcs(p); p.stroke(L(4.2, 3.4, 19.8, 21))

@icon("waveform")
def _(p):
    for x, h in ((3.6, 3.6), (7.8, 9.6), (12, 16), (16.2, 8), (20.4, 4.4)):
        p.stroke(L(x, 12 - h / 2, x, 12 + h / 2))

@icon("slider.horizontal.3")
def _(p):
    for y, k in ((5.6, 15.4), (12, 8.2), (18.4, 14.4)):
        p.stroke(L(3.4, y, 20.6, y), 0.85); p.dot(k, y, 2.3)

@icon("slider.horizontal.2")
def _(p):
    # Filters (John, Nov 7): two sliders, each with its knob.
    for y, k in ((8, 15.2), (16, 8.8)):
        p.stroke(L(3.4, y, 20.6, y), 0.85); p.dot(k, y, 2.5)

@icon("line.3.horizontal.decrease")
def _(p):
    p.stroke(L(3.4, 6.4, 20.6, 6.4)); p.stroke(L(6.6, 12, 17.4, 12)); p.stroke(L(9.6, 17.6, 14.4, 17.6))

@icon("list.bullet")
def _(p):
    for y in (6, 12, 18):
        p.dot(4.4, y, 1.45); p.stroke(L(8.6, y, 20.6, y))

@icon("list.bullet.clipboard")
def _(p):
    p.stroke(L(5, 5, 5, 20.8)); p.stroke(L(19, 5, 19, 20.8)); p.stroke(L(5.2, 21, 18.8, 21))
    p.stroke(L(5.2, 4.8, 8, 4.8), 0.9); p.stroke(L(16, 4.8, 18.8, 4.8), 0.9)
    p.stroke(L(9, 3.6, 15, 3.6), 1.25)
    for y in (10.4, 15.4):
        p.dot(8.6, y, 1.15); p.stroke(L(11.2, y, 16, y), 0.8)

@icon("gearshape")
def _(p):
    # One stroke round a toothed outline: eight teeth, rounded square wave.
    pts = []
    for k in range(361):
        a = math.radians(k + 8)
        wave = math.cos(8 * a)
        r = 7.1 + 1.5 * max(-1, min(1, wave * 2.2))
        pts.append((12 + r * math.cos(a), 12 + r * math.sin(a)))
    p.stroke(resample(pts[:352]), 0.9)
    p.stroke(RING(12, 12, 2.6, start=200), 0.85)

@icon("arrow.up.arrow.down")
def _(p):
    p.stroke(L(8, 19.4, 8, 5)); p.stroke(L(4.4, 8.6, 8, 4.7)); p.stroke(L(11.6, 8.6, 8, 4.7))
    p.stroke(L(16, 4.6, 16, 19)); p.stroke(L(12.4, 15.4, 16, 19.3)); p.stroke(L(19.6, 15.4, 16, 19.3))

@icon("moon.fill")
def _(p):
    # Crescent: a big disc with a smaller one bitten out of its upper right.
    c1, r1, c2, r2 = (11.4, 12.4), 8.6, (16.6, 8.2), 7.0
    outer = [(c1[0] + r1 * math.cos(math.radians(a)), c1[1] + r1 * math.sin(math.radians(a))) for a in range(0, 360, 4)]
    inside2 = lambda q: math.hypot(q[0] - c2[0], q[1] - c2[1]) < r2
    inside1 = lambda q: math.hypot(q[0] - c1[0], q[1] - c1[1]) < r1
    i = next(k for k in range(len(outer)) if inside2(outer[k - 1]) and not inside2(outer[k]))
    outer = outer[i:] + outer[:i]
    outer = [q for q in outer if not inside2(q)]
    inner = [(c2[0] + r2 * math.cos(math.radians(a)), c2[1] + r2 * math.sin(math.radians(a))) for a in range(0, 360, 4)]
    j = next(k for k in range(len(inner)) if not inside1(inner[k - 1]) and inside1(inner[k]))
    inner = inner[j:] + inner[:j]
    inner = [q for q in inner if inside1(q)][::-1]
    p.shapes.append([(x + p.rnd.uniform(-0.06, 0.06), y + p.rnd.uniform(-0.06, 0.06)) for x, y in outer + inner])

@icon("checkmark.shield")
def _(p):
    p.stroke(L(4.6, 6, 12, 3)); p.stroke(L(12, 3, 19.4, 6))
    p.stroke(C((19.4, 6), (19.8, 14.6), (15.4, 18.8), (12, 21.2))); p.stroke(C((4.6, 6), (4.2, 14.6), (8.6, 18.8), (12, 21.2)))
    p.stroke(L(8.6, 12, 11, 14.6), 0.85); p.stroke(L(11, 14.6, 15.6, 9), 0.85)

@icon("bell")
def _(p):
    p.stroke(C((6, 16.4), (6, 12.6), (5.6, 4.6), (12, 4.4)))
    p.stroke(C((18, 16.4), (18, 12.6), (18.4, 4.6), (12, 4.4)))
    p.stroke(L(3.8, 17, 20.2, 17))
    p.stroke(C((10, 19.6), (10.4, 21.6), (13.6, 21.6), (14, 19.6)), 0.9)
    p.stroke(L(12, 2.4, 12, 4.2), 0.8)

@icon("arrow.counterclockwise")
def _(p):
    # Undo: a near-full loop ending in an arrowhead at the upper left.
    p.stroke(A(12.4, 12.8, 7.6, 205, 500))
    p.stroke(L(5.4, 9.4, 5.2, 4), 0.95)
    p.stroke(L(5.4, 9.6, 10.6, 9.2), 0.95)

def poly(*pts):
    """One stroke through corner points: sharp corners, tapered only at its ends."""
    out = []
    for a, b in zip(pts, pts[1:]):
        seg = L(*a, *b)
        out += seg if not out else seg[1:]
    return out

def arrow(p, angle):
    """A full-size arrow pointing at angle degrees (0 = right, 90 = down)."""
    rot = lambda x, y: (12 + x * math.cos(math.radians(angle)) - y * math.sin(math.radians(angle)),
                        12 + x * math.sin(math.radians(angle)) + y * math.cos(math.radians(angle)))
    tail, tip = rot(-8, 0), rot(7.7, 0)
    p.stroke(L(*tail, *rot(7.4, 0)))
    p.stroke(L(*rot(1.6, -6.2), *tip)); p.stroke(L(*rot(1.6, 6.2), *tip))

@icon("arrow.left")
def _(p): arrow(p, 180)

@icon("arrow.up")
def _(p): arrow(p, 270)

@icon("arrow.down")
def _(p): arrow(p, 90)

@icon("arrow.right")
def _(p): arrow(p, 0)

@icon("arrow.up.right")
def _(p):
    # Opens a page outside the app.
    p.stroke(L(5.6, 18.4, 17.4, 6.6))
    p.stroke(L(8.6, 6, 17.9, 6.1)); p.stroke(L(17.9, 6.1, 18, 15.4))

@icon("viewfinder")
def _(p):
    # Four corner brackets: the court in frame.
    p.stroke(poly((3.6, 8.8), (3.6, 3.6), (8.8, 3.6)))
    p.stroke(poly((15.2, 3.6), (20.4, 3.6), (20.4, 8.8)))
    p.stroke(poly((20.4, 15.2), (20.4, 20.4), (15.2, 20.4)))
    p.stroke(poly((8.8, 20.4), (3.6, 20.4), (3.6, 15.2)))

@icon("ellipsis.circle")
def _(p): ring(p); [p.dot(x, 12, 1.2) for x in (8, 12, 16)]

def mic(p):
    p.stroke(A(12, 6.6, 3.2, 180, 360), 0.95); p.stroke(A(12, 10.8, 3.2, 0, 180), 0.95)
    p.stroke(L(8.8, 6.6, 8.8, 10.8), 0.95); p.stroke(L(15.2, 6.6, 15.2, 10.8), 0.95)
    p.stroke(E(12, 11, 6.4, 6.2, 0, 180), 0.85)
    p.stroke(L(12, 17.4, 12, 20.4), 0.85); p.stroke(L(8.6, 20.6, 15.4, 20.6), 0.85)

@icon("mic.slash")
def _(p): mic(p); p.stroke(L(4, 3.4, 20, 20.6))

def speaker(p, dx=0.0):
    # Outlined, so a slash stays readable across it.
    p.stroke(poly((3.6 + dx, 8.8), (7.8 + dx, 8.8), (12.6 + dx, 4.4), (12.6 + dx, 19.6), (7.8 + dx, 15.2), (3.6 + dx, 15.2), (3.6 + dx, 9)))

@icon("speaker.wave.2.fill")
def _(p):
    speaker(p, -0.8)
    p.stroke(A(12.4, 12, 3.6, -42, 42), 0.85); p.stroke(A(12.4, 12, 7.6, -46, 46), 0.85)

@icon("speaker.slash.fill")
def _(p): speaker(p, 1.6); p.stroke(L(3.6, 3.4, 20.6, 20.6))

@icon("battery.25")
def _(p):
    p.stroke(poly((2.8, 7.4), (18.6, 7.4), (18.6, 16.6), (2.8, 16.6), (2.8, 7.6)), 0.95)
    p.stroke(L(21, 10.4, 21, 13.6), 1.1)
    p.blob([(5.2, 9.8), (8.6, 9.8), (8.6, 14.2), (5.2, 14.2)])

@icon("externaldrive.badge.exclamationmark")
def _(p):
    # A drive with its upper right corner left open for the warning badge.
    p.stroke(L(2.8, 10.6, 12.2, 10.6)); p.stroke(L(2.6, 10.8, 2.6, 19.2))
    p.stroke(L(2.8, 19.4, 15.6, 19.4)); p.stroke(L(15.8, 19.2, 15.8, 14.4))
    p.dot(6, 15.6, 1.1); p.stroke(L(8.8, 15.6, 12.4, 15.6), 0.75)
    p.stroke(RING(17.4, 7.8, 4.6, start=200), 0.85)
    p.stroke(L(17.4, 5.4, 17.4, 8.6), 0.75); p.dot(17.4, 10.6, 0.85)

@icon("megaphone")
def _(p):
    # "Posted": an open match announced near you.
    p.stroke(poly((3.6, 9.6), (7.6, 9.6), (16.4, 4.4), (16.4, 19.6), (7.6, 14.4), (3.6, 14.4), (3.6, 9.8)))
    p.stroke(L(7.6, 9.8, 7.6, 14.2), 0.75)
    p.stroke(L(8, 14.8, 9.6, 19.8), 0.9)
    p.stroke(A(16.4, 12, 4.6, -38, 38), 0.8)

# ---------- milestone badges (decisions 149 and 150) ----------
#
# One icon per launch milestone, drawn to sit inside the design system's brush
# ring (BrushRing) on the badge: on the player card, on Career and in the
# milestone moment. The ring carries the "badge"; these carry what was earned.

def flame(p, cx, bottom, s=1.0, w=1.0):
    """A hand-drawn flame: an outer teardrop with a lick to the left, and an inner tongue."""
    def at(x, y): return (cx + (x - 12) * s, bottom + (y - 20.6) * s)
    outer = (C(at(12, 3), at(16, 7), at(18.2, 10.5), at(17.6, 14.2)) +
             C(at(17.6, 14.2), at(17.2, 18), at(14.6, 20.6), at(12, 20.6))[1:] +
             C(at(12, 20.6), at(9.4, 20.6), at(6.6, 18.2), at(6.6, 14.6))[1:] +
             C(at(6.6, 14.6), at(6.6, 11.4), at(9, 9.6), at(10, 7))[1:])
    p.stroke(outer, w)
    p.stroke(C(at(12.2, 12.2), at(14.6, 14.4), at(14.8, 17.6), at(12, 18.4)) +
             C(at(12, 18.4), at(9.8, 18.6), at(9.4, 15.6), at(11, 13.6))[1:], 0.75 * w)

@icon("milestone.firstwin")
def _(p):
    # First win: a trophy cup with two handles, a stem and a base.
    p.stroke(L(6.6, 4.6, 17.4, 4.5))
    p.stroke(C((7, 4.8), (7, 11), (9.4, 13.2), (12, 13.2)) + C((12, 13.2), (14.6, 13.2), (17, 11), (17, 4.8))[1:])
    p.stroke(E(7, 7.6, 2.5, 2.3, 270, 90), 0.8)
    p.stroke(E(17, 7.6, 2.5, 2.3, -90, 90), 0.8)
    p.stroke(L(12, 13.6, 12, 17), 0.9)
    p.stroke(L(9.4, 17.2, 14.6, 17.3), 0.8)
    p.stroke(L(8.2, 19.6, 15.8, 19.5))

@icon("milestone.ballboi")
def _(p):
    # First Ball Boi match: a video camera with its record dot.
    p.stroke(L(3.6, 7.4, 14.8, 7.3)); p.stroke(L(15, 7.6, 15.1, 16.4))
    p.stroke(L(14.9, 16.7, 3.7, 16.6)); p.stroke(L(3.4, 16.4, 3.5, 7.6))
    p.stroke(L(15.4, 10.6, 20.5, 7.6), 0.9); p.stroke(L(20.6, 7.8, 20.6, 16.2), 0.9); p.stroke(L(20.5, 16.4, 15.4, 13.4), 0.9)
    p.dot(7.4, 10.8, 1.25)

@icon("milestone.streak5")
def _(p):
    # 5-match win streak: one flame.
    flame(p, 12, 20.8, 1.0)

@icon("milestone.streak10")
def _(p):
    # 10-match win streak: two flames, the second smaller beside it.
    flame(p, 9.6, 21, 0.9)
    flame(p, 17.6, 21, 0.58, 0.85)

# ---------- wide marks (not icons) ----------
#
# The winner underline (John, Nov 8): one brush stroke under the winner's name
# wherever a finished match shows both players. Drawn on a 100 x 8 grid and
# stretched to the name's width in the app, so it's tapered by hand here
# rather than by Pen: a firm start, full in the first third, lifting off thin
# at the right, with a slight rise so it never reads as a text underline.

def underline_mark():
    rnd = random.Random("winner.underline")
    pts = C((2, 5.4), (30, 4.6), (64, 3.6), (98, 3.4))
    n = len(pts)
    top, bot = [], []
    for i, (x, y) in enumerate(pts):
        t = i / (n - 1)
        if t < 0.08: k = 0.55 + 0.45 * math.sin(t / 0.08 * math.pi / 2)
        elif t < 0.35: k = 1.0
        else: k = 1.0 - 0.78 * ((t - 0.35) / 0.65) ** 1.4
        hw = 1.35 * k * (1 + 0.06 * math.sin(9 * t + 1.3))
        y += 0.12 * math.sin(5.5 * t + 0.4)
        top.append((x, y - hw)); bot.append((x, y + hw))
    a, b = pts[0], pts[-1]
    start = [(a[0] - 0.9, a[1] + 0.1)]
    end = [(b[0] + 0.5, b[1] - 0.05)]
    poly = top + end + bot[::-1] + start
    poly = [(x + rnd.uniform(-0.03, 0.03), y) for x, y in poly]
    return to_path([poly])

MARKS = {"winner.underline": (underline_mark, "0 0 100 8")}

# ---------- write ----------

def build():
    out = {}
    for name, (fn, _) in ICONS.items():
        p = Pen(name); fn(p); out[name] = to_path(p.shapes)
    return out

if __name__ == "__main__":
    root = os.getcwd()
    paths = build()
    ts = os.path.join(root, "artifacts/mobile/components/icons/brushPaths.ts")
    svgdir = os.path.join(root, "docs/design-system/icons/ui")
    os.makedirs(os.path.dirname(ts), exist_ok=True); os.makedirs(svgdir, exist_ok=True)
    with open(ts, "w") as f:
        f.write("// Generated by scripts/design/brush-icons.py. Don't edit by hand: change the\n")
        f.write("// script and re-run it. Every icon is a filled brush mark on a 24 grid.\n\n")
        f.write("export const BRUSH_PATHS = {\n")
        for name in sorted(paths):
            f.write(f"  {json.dumps(name)}:\n    {json.dumps(paths[name])},\n")
        f.write("} as const;\n\nexport type IconName = keyof typeof BRUSH_PATHS;\n")
    for name, d in paths.items():
        with open(os.path.join(svgdir, name + ".svg"), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="{d}"/></svg>\n')
    marks = {name: (fn(), box) for name, (fn, box) in MARKS.items()}
    with open(os.path.join(root, "artifacts/mobile/components/icons/brushMarks.ts"), "w") as f:
        f.write("// Generated by scripts/design/brush-icons.py. Don't edit by hand: change the\n")
        f.write("// script and re-run it. Wide brush marks, stretched to fit what they mark.\n\n")
        f.write("export const BRUSH_MARKS = {\n")
        for name in sorted(marks):
            d, box = marks[name]
            f.write(f"  {json.dumps(name)}: {{ viewBox: {json.dumps(box)}, d: {json.dumps(d)} }},\n")
        f.write("} as const;\n\nexport type BrushMarkName = keyof typeof BRUSH_MARKS;\n")
    for name, (d, box) in marks.items():
        bw, bh = box.split()[2:]
        with open(os.path.join(svgdir, name + ".svg"), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" width="{int(bw) * 2}" height="{int(bh) * 2}" preserveAspectRatio="none" aria-hidden="true"><path fill="currentColor" d="{d}"/></svg>\n')
    print(f"ok, {len(paths)} icons, {len(marks)} marks")
