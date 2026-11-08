"""
Court keypoints: where the court is in the video.

The phone does court detection on device and sends the four singles corners
(the spec's "court-line fix" lets players correct them). Those always win.
When they're missing, this module finds the court itself, with the same
method as the phone (artifacts/mobile/lib/court/detect.ts), on a frame the
same size (480 pixels on the long side), so both sides agree:

1. Paint: thin, bright, unsaturated marks (a white top-hat), kept only where
   the marks run in one clear direction. Tree branches against the sky,
   fence wire and net mesh make blotches with no single direction.
2. Lines: straight lines through that paint, found one at a time (each found
   line's pixels are taken out before looking for the next), so one thick
   painted line is never counted twice. Pale yellow lines (pickleball lines
   painted over a tennis court) never count as court paint; "yellow" is
   judged against the frame's own strongest lines.
3. Fit: two lines across the court and two along it, matched to every pair
   of regulation court lines they could be (a model-fitting method in the
   style of Farin et al., "Robust camera calibration for sport videos using
   court models", 2004). Views no camera behind the baseline could take are
   thrown out: the court passing behind the camera, corners on top of each
   other, crossed shapes, a far baseline wider than the near one, a lens no
   phone has. The rest are scored by how much of the court's paint, in pixels
   on screen, lands on painted lines, minus what lands on bare court.
4. Refine: the best view is pulled onto the painted lines it explains.

A view where the far baseline is hidden behind the net fits from the near
baseline, service lines and sidelines alone.

No third-party weights: the widely used tennis keypoint model has no license,
so it can't ship in a commercial app. The labeled test set lets us train our
own keypoint model later if this falls short.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

import cv2
import numpy as np

from services import court_model as cm

ANALYSIS_LONG_SIDE = 480   # the phone's analysis size (lib/court/still.ts)

_DW, _SW, _HL, _SL = cm.DOUBLES_HALF_WIDTH, cm.SINGLES_HALF_WIDTH, cm.HALF_LENGTH, cm.SERVICE_LINE

# Every painted line once: baselines (doubles width), service lines, centre service line, four sidelines.
_PAINT = np.array([
    [[-_DW, -_HL], [_DW, -_HL]],
    [[-_DW, _HL], [_DW, _HL]],
    [[-_SW, -_SL], [_SW, -_SL]],
    [[-_SW, _SL], [_SW, _SL]],
    [[0.0, -_SL], [0.0, _SL]],
    [[-_SW, -_HL], [-_SW, _HL]],
    [[_SW, -_HL], [_SW, _HL]],
    [[-_DW, -_HL], [-_DW, _HL]],
    [[_DW, -_HL], [_DW, _HL]],
])
_DOUBLES_CORNERS_M = np.array([[-_DW, -_HL], [_DW, -_HL], [_DW, _HL], [-_DW, _HL]])

# Lines a camera behind the baseline can see. Across: far to near. Along: left to right.
_ACROSS = (_HL, _SL, -_SL, -_HL)
_ALONG = (-_DW, -_SW, 0.0, _SW, _DW)

YELLOW_MARGIN = 0.09          # yellower than the frame's main lines by this: not tennis paint
_ACROSS_MAX = math.radians(22)
_ALONG_MIN = math.radians(10)
_MAX_ACROSS = 6
_MAX_ALONG = 8
_KEEP = 10
_MISS_COST = 0.5
_FOCAL_RANGE = (0.3, 3.0)     # focal length over frame width: ~120 to ~20 degrees across
MIN_FIT_SCORE = 0.35

_THETA_STEPS = 360
_VOTE_SPREAD = 8
_COS = np.cos(np.arange(_THETA_STEPS) * np.pi / _THETA_STEPS)
_SIN = np.sin(np.arange(_THETA_STEPS) * np.pi / _THETA_STEPS)


def _jsround(v):
    """Rounds halves up, as JavaScript's Math.round does, so both sides pick the same pixels."""
    return np.floor(np.asarray(v, dtype=np.float64) + 0.5).astype(np.int64)


@dataclass
class CourtFit:
    corners: list[list[float]]   # normalized singles corners, calibration order
    confidence: float            # share of the court's painted lines on screen that land on paint
    source: str                  # "phone" or "detected"

    @property
    def image_to_court(self) -> np.ndarray:
        return cm.image_to_court_matrix(self.corners)


def line_mask(frame: np.ndarray) -> np.ndarray:
    """Thin bright marks: court paint, not sky or white clothing blobs."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = max(5, int(round(min(h, w) / 60)) | 1)
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    low_sat = hsv[..., 1] < 90
    mask = ((tophat > 25) & low_sat & (gray > 120)).astype(np.uint8) * 255
    return mask


# ─── Lines ───────────────────────────────────────────────────────────────────

def _strokes(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Paint pixels that sit on a line (a clear single direction in a 9 x 9 window): x, y, normal step."""
    m = (mask > 0).astype(np.float64)
    r = 4
    d = np.arange(-r, r + 1, dtype=np.float64)
    dx, dy = np.meshgrid(d, d)
    def box(kernel):
        return cv2.filter2D(m, -1, kernel, borderType=cv2.BORDER_CONSTANT)
    n = box(np.ones_like(dx))
    sx, sy = box(dx), box(dy)
    sxx, syy, sxy = box(dx * dx), box(dy * dy), box(dx * dy)
    ys, xs = np.nonzero(mask)
    n = n[ys, xs]
    keep = n >= 4 - 1e-9
    ys, xs, n = ys[keep], xs[keep], n[keep]
    sx, sy = sx[ys, xs], sy[ys, xs]
    cxx = sxx[ys, xs] / n - (sx / n) ** 2
    cyy = syy[ys, xs] / n - (sy / n) ** 2
    cxy = sxy[ys, xs] / n - (sx / n) * (sy / n)
    tr = cxx + cyy
    with np.errstate(invalid="ignore", divide="ignore"):
        coherence = np.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy) / tr
    keep = (tr > 0) & (coherence >= 0.6)
    xs, ys = xs[keep], ys[keep]
    along = 0.5 * np.arctan2(2 * cxy[keep], cxx[keep] - cyy[keep])
    normal = np.mod(along + np.pi / 2, np.pi)
    t = _jsround(normal / np.pi * _THETA_STEPS) % _THETA_STEPS
    return xs.astype(np.int64), ys.astype(np.int64), t


def _fit_line(xs: np.ndarray, ys: np.ndarray) -> tuple[float, float] | None:
    """Total least squares line in normal form (rho, theta)."""
    if len(xs) < 2:
        return None
    mx, my = xs.mean(), ys.mean()
    dx, dy = xs - mx, ys - my
    cxx, cyy, cxy = (dx * dx).sum(), (dy * dy).sum(), (dx * dy).sum()
    along = 0.5 * math.atan2(2 * cxy, cxx - cyy)
    theta = (along + math.pi / 2) % math.pi
    return mx * math.cos(theta) + my * math.sin(theta), theta


def _step_gap(a, b):
    d = np.abs(np.asarray(a) - b) % _THETA_STEPS
    return np.minimum(d, _THETA_STEPS - d)


def _pixel_yellow(frame: np.ndarray, xs: np.ndarray, ys: np.ndarray, theta: float) -> np.ndarray:
    """
    How yellow the paint at each line pixel is: 0 for white, about 0.5 for strong
    yellow. The court beside the line (3 and 4 pixels out on each side) is taken
    out first, so each channel's rise toward full brightness is the same for
    white paint on any court colour, while blue rises less for yellow.
    """
    h, w = frame.shape[:2]
    nx, ny = math.cos(theta), math.sin(theta)
    back = np.zeros((len(xs), 3))
    count = np.zeros(len(xs))
    for d in (-4, -3, 3, 4):
        bx = _jsround(xs + nx * d)
        by = _jsround(ys + ny * d)
        ok = (bx >= 0) & (bx < w) & (by >= 0) & (by < h)
        back[ok] += frame[by[ok], bx[ok]].astype(np.float64)
        count[ok] += 1
    out = np.zeros(len(xs))
    have = count > 0
    b = back[have] / count[have, None]
    px = frame[ys[have], xs[have]].astype(np.float64)
    rise = (px - b) / (256 - b)                        # BGR order
    rg = (rise[:, 2] + rise[:, 1]) / 2
    out[have] = np.where(rg > 0.05, 1 - rise[:, 0] / np.where(rg > 0.05, rg, 1), 0)
    return out


def _line_yellow(frame: np.ndarray, xs: np.ndarray, ys: np.ndarray, rho: float, theta: float) -> float:
    """
    How yellow a line's paint is. Each side of the line is judged on its own (the
    middle value of its pixels) and the whiter side counts: a white line with a
    yellow one painted right beside it (a pickleball baseline by the service line)
    found as one thick line stays white, while a yellow line is yellow on both sides.
    """
    yellow = _pixel_yellow(frame, xs, ys, theta)
    side = (xs * math.cos(theta) + ys * math.sin(theta) - rho) >= 0
    def middle(v):
        v = np.sort(v)
        return float(v[len(v) >> 1])
    judged = [middle(yellow[side == k]) for k in (False, True) if (side == k).sum() >= 8]
    return min(judged) if judged else middle(yellow)


@dataclass
class _Line:
    rho: float
    theta: float
    votes: int
    yellow: float
    pixels: np.ndarray            # flat indexes y * w + x


def _find_lines(frame: np.ndarray, mask: np.ndarray, min_votes: float, max_lines: int = 24) -> list[_Line]:
    """Long straight lines in the paint, strongest first, each painted line once."""
    h, w = mask.shape
    xs, ys, ts = _strokes(mask)
    diag = int(math.ceil(math.hypot(w, h)))
    rho_size = diag * 2 + 1
    acc = np.zeros(_THETA_STEPS * rho_size, dtype=np.int64)

    def vote(idx: np.ndarray, sign: int) -> None:
        if len(idx) == 0:
            return
        x, y, t0 = xs[idx], ys[idx], ts[idx]
        for d in range(-_VOTE_SPREAD, _VOTE_SPREAD + 1):
            t = t0 + d
            flip = np.where((t < 0) | (t >= _THETA_STEPS), -1, 1)
            t = t % _THETA_STEPS
            rho = _jsround(flip * (x * _COS[t] + y * _SIN[t])) + diag
            np.add.at(acc, t * rho_size + rho, sign)

    vote(np.arange(len(xs)), 1)
    used = np.zeros(len(xs), dtype=bool)

    def near(rho: float, theta: float, tol: float) -> np.ndarray:
        t_step = int(_jsround(theta / math.pi * _THETA_STEPS)) % _THETA_STEPS
        ok = ~used & (_step_gap(ts, t_step) <= _VOTE_SPREAD + 2)
        ok &= np.abs(xs * math.cos(theta) + ys * math.sin(theta) - rho) <= tol
        return np.nonzero(ok)[0]

    lines: list[_Line] = []
    for _ in range(max_lines * 2):
        if len(lines) >= max_lines:
            break
        cell = int(acc.argmax())
        if acc[cell] < min_votes:
            break
        t0 = cell // rho_size
        peak = ((cell % rho_size) - diag, t0 * math.pi / _THETA_STEPS)
        first = near(*peak, 2)
        refined = _fit_line(xs[first].astype(float), ys[first].astype(float)) or peak
        support = near(*refined, 2)
        taken = np.union1d(first, support)
        vote(taken, -1)
        used[taken] = True
        if len(support) < min_votes:
            continue
        rho, theta = _fit_line(xs[support].astype(float), ys[support].astype(float)) or refined
        yellow = _line_yellow(frame, xs[support], ys[support], rho, theta)
        c, s = math.cos(theta), math.sin(theta)
        along = -xs[support] * s + ys[support] * c
        ends = [(rho * c - a * s, rho * s + a * c) for a in (along.min(), along.max())]
        twin = None
        for l in lines:
            close = all(abs(px * math.cos(l.theta) + py * math.sin(l.theta) - l.rho) < 3.5 for px, py in ends)
            if close and _step_gap(int(_jsround(l.theta / math.pi * _THETA_STEPS)),
                                   int(_jsround(theta / math.pi * _THETA_STEPS))) <= 6:
                twin = l
                break
        pixels = ys[support] * w + xs[support]
        if twin is not None:
            twin.votes += len(support)
            twin.pixels = np.concatenate([twin.pixels, pixels])
            continue
        lines.append(_Line(rho, theta, len(support), yellow, pixels))
    lines.sort(key=lambda l: -l.votes)
    return lines


def _white_level(lines: list[_Line]) -> float:
    """How yellow white paint looks in this frame: the middle of its three strongest lines."""
    top = sorted(l.yellow for l in sorted(lines, key=lambda l: -l.votes)[:3])
    return top[(len(top) - 1) >> 1] if top else 0.0


# ─── Views ───────────────────────────────────────────────────────────────────

def _intersect(a: tuple[float, float], b: tuple[float, float]) -> np.ndarray | None:
    c1, s1, c2, s2 = math.cos(a[1]), math.sin(a[1]), math.cos(b[1]), math.sin(b[1])
    det = c1 * s2 - s1 * c2
    if abs(det) < 1e-6:
        return None
    return np.array([(a[0] * s2 - s1 * b[0]) / det, (c1 * b[0] - a[0] * c2) / det])


def _apply(hm: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Court meters (N, 2) through a stack of views (V, 3, 3) to pixels (V, N, 2)."""
    p = np.concatenate([pts, np.ones((len(pts), 1))], axis=1)
    q = np.einsum("vij,nj->vni", hm, p)
    with np.errstate(divide="ignore", invalid="ignore"):
        return q[..., :2] / q[..., 2:3]


def _convex(q: np.ndarray) -> np.ndarray:
    """(V, 4, 2) quads -> True where convex with no corner folded nearly flat."""
    a, b, c = q, np.roll(q, -1, axis=1), np.roll(q, -2, axis=1)
    e1, e2 = b - a, c - b
    cross = e1[..., 0] * e2[..., 1] - e1[..., 1] * e2[..., 0]
    scale = np.linalg.norm(e1, axis=-1) * np.linalg.norm(e2, axis=-1)
    with np.errstate(invalid="ignore"):
        firm = np.abs(cross) > 0.02 * scale
        same = np.all(cross > 0, axis=1) | np.all(cross < 0, axis=1)
    return np.all(firm, axis=1) & same


def _camera_can_see(hm: np.ndarray, w: int, h: int) -> np.ndarray:
    """True where a centred camera with square pixels and a phone's focal length could take the view."""
    g1, g2 = hm[:, 2, 0], hm[:, 2, 1]
    a1, b1, c1 = hm[:, 0, 0] - w / 2 * g1, hm[:, 1, 0] - h / 2 * g1, g1
    a2, b2, c2 = hm[:, 0, 1] - w / 2 * g2, hm[:, 1, 1] - h / 2 * g2, g2
    A1, B1 = a1 * a2 + b1 * b2, c1 * c2
    A2, B2 = a1 ** 2 + b1 ** 2 - a2 ** 2 - b2 ** 2, c1 ** 2 - c2 ** 2
    den = A1 ** 2 + A2 ** 2
    with np.errstate(divide="ignore", invalid="ignore"):
        u = -(A1 * B1 + A2 * B2) / den
        f = 1 / np.sqrt(np.where(u > 0, u, np.nan))
        r1 = np.stack([a1 / f, b1 / f, c1], axis=1)
        r2 = np.stack([a2 / f, b2 / f, c2], axis=1)
        n1, n2 = np.linalg.norm(r1, axis=1), np.linalg.norm(r2, axis=1)
        cos = (r1 * r2).sum(axis=1) / (n1 * n2)
        ratio = n1 / n2
        return ((den > 0) & (u > 0) & (f >= _FOCAL_RANGE[0] * w) & (f <= _FOCAL_RANGE[1] * w)
                & (np.abs(cos) < 0.25) & (ratio > 0.8) & (ratio < 1.25))


def _plausible(hm: np.ndarray, w: int, h: int) -> np.ndarray:
    """(V, 3, 3) views -> True where a camera behind the near baseline could see it."""
    d = np.einsum("vj,nj->vn", hm[:, 2, :], np.concatenate([_DOUBLES_CORNERS_M, np.ones((4, 1))], axis=1))
    ok = np.all(np.isfinite(d) & (np.abs(d) > 1e-9), axis=1) & (np.all(d > 0, axis=1) | np.all(d < 0, axis=1))
    quad = _apply(hm, cm.SINGLES_CORNERS_M)
    ok &= np.all(np.isfinite(quad), axis=(1, 2))
    quad = np.nan_to_num(quad, nan=0.0, posinf=1e9, neginf=-1e9)
    nl, nr, fr, fl = quad[:, 0], quad[:, 1], quad[:, 2], quad[:, 3]
    ok &= (fl[:, 1] < nl[:, 1]) & (fr[:, 1] < nr[:, 1]) & (nl[:, 0] < nr[:, 0]) & (fl[:, 0] < fr[:, 0])
    ok &= (fr[:, 0] - fl[:, 0]) <= (nr[:, 0] - nl[:, 0]) * 1.02
    for i, j in itertools.combinations(range(4), 2):
        ok &= np.linalg.norm(quad[:, i] - quad[:, j], axis=1) >= 0.02 * w
    ok &= _convex(quad)
    x, y = quad[..., 0], quad[..., 1]
    area = 0.5 * np.abs((x * np.roll(y, -1, axis=1) - np.roll(x, -1, axis=1) * y).sum(axis=1))
    ok &= (area >= 0.03 * w * h) & (area <= 4 * w * h)
    ok &= (nl[:, 1] <= 3 * h) & (nr[:, 1] <= 3 * h) & (nl[:, 0] >= -3 * w) & (nr[:, 0] <= 4 * w)
    far_x, far_y = (fl[:, 0] + fr[:, 0]) / 2, (fl[:, 1] + fr[:, 1]) / 2
    ok &= (far_y > -0.1 * h) & (far_y < 0.9 * h) & (far_x > -0.2 * w) & (far_x < 1.2 * w)
    if ok.any():
        ok[ok] &= _camera_can_see(hm[ok], w, h)
    return ok


def _clip(p: np.ndarray, q: np.ndarray, w: int, h: int) -> tuple[float, float] | None:
    """The part of segment p-q inside the frame, as a range of t from 0 to 1."""
    t0, t1 = 0.0, 1.0
    dx, dy = q[0] - p[0], q[1] - p[1]
    for a, b in ((-dx, p[0]), (dx, w - 1 - p[0]), (-dy, p[1]), (dy, h - 1 - p[1])):
        if a == 0:
            if b < 0:
                return None
            continue
        r = b / a
        if a < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return (t0, t1) if t1 > t0 else None


def _score(hm: np.ndarray, on_paint: np.ndarray, step: float) -> tuple[int, int]:
    """Walks every painted court line as it falls on screen, a sample every `step` pixels: (hits, visible)."""
    h, w = on_paint.shape
    ends = _apply(hm[None], _PAINT.reshape(-1, 2))[0].reshape(-1, 2, 2)
    hits = visible = 0
    for p, q in ends:
        rng = _clip(p, q, w, h)
        if rng is None:
            continue
        length = math.hypot(q[0] - p[0], q[1] - p[1]) * (rng[1] - rng[0])
        n = max(1, int(length // step))
        t = rng[0] + (rng[1] - rng[0]) * np.arange(n + 1) / n
        xs = (p[0] + (q[0] - p[0]) * t).astype(np.int64)
        ys = (p[1] + (q[1] - p[1]) * t).astype(np.int64)
        visible += n + 1
        hits += int(on_paint[ys, xs].sum())
    return hits, visible


def _rank(s: tuple[int, int]) -> float:
    return s[0] - _MISS_COST * (s[1] - s[0])


def _fit_to_lines(matches: list[tuple[tuple[float, float], np.ndarray]], w: int, start: np.ndarray) -> np.ndarray | None:
    """
    Least-squares view that puts each model line on its matched image line, in
    pixels: each equation is divided by the view's depth at its point (from the
    last estimate, starting at `start`), so far and near lines count alike.
    """
    to_n = np.diag([1 / w, 1 / w, 1.0])
    from_n = np.diag([10.0, 10.0, 1.0])
    hm = start
    for _ in range(3):
        prior = to_n @ hm @ from_n
        prior = prior / prior[2, 2]
        rows, rhs = [], []
        for (rho, theta), points in matches:
            a, b, c = math.cos(theta), math.sin(theta), -rho / w
            for X, Y in points / 10:
                depth = abs(prior[2, 0] * X + prior[2, 1] * Y + 1)
                k = 1 / max(depth, 1e-6)
                rows.append([k * a * X, k * a * Y, k * a, k * b * X, k * b * Y, k * b, k * c * X, k * c * Y])
                rhs.append(-k * c)
        if len(rows) < 8:
            return None
        A, B = np.array(rows), np.array(rhs)
        try:
            hn = np.linalg.solve(A.T @ A, A.T @ B)
        except np.linalg.LinAlgError:
            return None
        n = np.append(hn, 1).reshape(3, 3)
        hm = np.diag([w, w, 1.0]) @ n @ np.diag([0.1, 0.1, 1.0])
    return hm


def _refine(hm: np.ndarray, mask: np.ndarray, band: float) -> np.ndarray | None:
    """Pulls a view onto the paint it explains: fit a line to the paint along each court line, re-solve."""
    h, w = mask.shape
    try:
        inv = np.linalg.inv(hm)
    except np.linalg.LinAlgError:
        return None
    ends = _apply(hm[None], _PAINT.reshape(-1, 2))[0].reshape(-1, 2, 2)
    matches = []
    across = 0
    offsets = np.arange(-band, band + 0.25, 0.5)
    for seg, (p, q) in zip(_PAINT, ends):
        rng = _clip(p, q, w, h)
        if rng is None:
            continue
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        visible = length * (rng[1] - rng[0])
        if visible < 15:
            continue
        u = (q - p) / length
        dist = np.arange(rng[0] * length, rng[1] * length + 1e-9, 1.0)
        px = _jsround(p[0] + u[0] * dist[:, None] - u[1] * offsets[None, :])
        py = _jsround(p[1] + u[1] * dist[:, None] + u[0] * offsets[None, :])
        dd = np.broadcast_to(dist[:, None], px.shape)
        ok = (px >= 0) & (px < w) & (py >= 0) & (py < h)
        px, py, dd = px[ok], py[ok], dd[ok]
        on = mask[py, px] > 0
        px, py, dd = px[on], py[on], dd[on]
        if len(px) == 0:
            continue
        _, first = np.unique(py * w + px, return_index=True)
        px, py, dd = px[first], py[first], dd[first]
        if len(px) < 12 or dd.max() - dd.min() < min(40, visible * 0.4):
            continue
        line = _fit_line(px.astype(float), py.astype(float))
        if line is None:
            continue
        dmin, dmax = dd.min(), dd.max()
        img = np.array([p + u * d for d in (dmin, (dmin + dmax) / 2, dmax)])
        court = _apply(inv[None], img)[0]
        a, b = seg
        ab = b - a
        t = ((court - a) @ ab) / (ab @ ab)
        points = a + t[:, None] * ab
        matches.append((line, points))
        across += seg[0][1] == seg[1][1]
    if across < 2 or len(matches) - across < 2:
        return None
    return _fit_to_lines(matches, w, hm)


def _detect_small(frame: np.ndarray) -> tuple[np.ndarray, float] | None:
    """The best view (court meters to pixels) and its confidence, on a frame at the analysis size."""
    h, w = frame.shape[:2]
    mask = line_mask(frame)
    found = _find_lines(frame, mask, min(w, h) * 0.07)
    min_line = min(w, h) * 0.12
    white = _white_level([l for l in found if l.votes >= min_line])
    yellow = [l.yellow > white + YELLOW_MARGIN for l in found]
    on_court = np.zeros(h * w, dtype=np.uint8)
    for l, y in zip(found, yellow):
        if not y:
            on_court[l.pixels] = 1
    on_court = on_court.reshape(h, w)
    lines = [l for l, y in zip(found, yellow) if not y and l.votes >= min_line]
    tilt = [abs(l.theta - math.pi / 2) for l in lines]
    across = [l for l, t in zip(lines, tilt) if t < _ACROSS_MAX][:_MAX_ACROSS]
    along = [l for l, t in zip(lines, tilt) if t > _ALONG_MIN][:_MAX_ALONG]
    if len(across) < 2 or len(along) < 2:
        return None
    near1 = cv2.dilate(on_court, np.ones((3, 3), np.uint8))
    near2 = cv2.dilate(on_court, np.ones((5, 5), np.uint8))

    def y_at_center(l: _Line) -> float:
        return (l.rho - (w / 2) * math.cos(l.theta)) / math.sin(l.theta)

    models = []
    for y_far, y_near in itertools.combinations(_ACROSS, 2):
        for x_left, x_right in itertools.combinations(_ALONG, 2):
            dx, dy = x_right - x_left, y_far - y_near
            models.append([[1 / dx, 0, -x_left / dx], [0, 1 / dy, -y_near / dy], [0, 0, 1]])
    models = np.array(models)
    unit = [(0, 0), (1, 0), (1, 1), (0, 1)]

    kept: list[tuple[float, np.ndarray]] = []
    for a, b in itertools.combinations(across, 2):
        upper, lower = (a, b) if y_at_center(a) < y_at_center(b) else (b, a)
        for c, d in itertools.combinations(along, 2):
            if c in (upper, lower) or d in (upper, lower):
                continue
            lc, ld = _intersect((lower.rho, lower.theta), (c.rho, c.theta)), _intersect((lower.rho, lower.theta), (d.rho, d.theta))
            if lc is None or ld is None:
                continue
            left, right = (c, d) if lc[0] < ld[0] else (d, c)
            img = [_intersect((lower.rho, lower.theta), (left.rho, left.theta)),
                   _intersect((lower.rho, lower.theta), (right.rho, right.theta)),
                   _intersect((upper.rho, upper.theta), (right.rho, right.theta)),
                   _intersect((upper.rho, upper.theta), (left.rho, left.theta))]
            if any(p is None for p in img):
                continue
            p0, p1, p2, p3 = img
            if not (p3[1] < p0[1] and p2[1] < p1[1] and p0[0] < p1[0] and p3[0] < p2[0]):
                continue
            if p2[0] - p3[0] > (p1[0] - p0[0]) * 1.02 or not _convex(np.array([img]))[0]:
                continue
            try:
                square = cm.homography(unit, img)
            except (ValueError, np.linalg.LinAlgError):
                continue
            views = square[None] @ models
            ok = _plausible(views, w, h)
            for hm in views[ok]:
                r = _rank(_score(hm, near2, 6))
                if len(kept) < _KEEP or r > kept[-1][0]:
                    kept.append((r, hm))
                    kept.sort(key=lambda k: -k[0])
                    del kept[_KEEP:]
    if not kept:
        return None

    best: tuple[float, np.ndarray] | None = None
    for _, hm in kept:
        r = _rank(_score(hm, near1, 2))
        for band in (4, 2):
            nxt = _refine(hm, on_court, band)
            if nxt is None or not _plausible(nxt[None], w, h)[0]:
                break
            nr = _rank(_score(nxt, near1, 2))
            if nr < r:
                break
            hm, r = nxt, nr
        if best is None or r > best[0]:
            best = (r, hm)
    hm = best[1]
    hits, visible = _score(hm, near2, 2)
    coverage = min(1.0, visible / (0.75 * w))
    corners = _apply(hm[None], cm.SINGLES_CORNERS_M)[0] / [w, h]
    shape_ok = _shape_ok(corners)
    confidence = hits / visible * coverage if shape_ok and visible else 0.0
    return hm, confidence


def _shape_ok(c: np.ndarray) -> bool:
    """The phone's isCourtShape (lib/court/geometry.ts): convex, far baseline above the near one, left staying left."""
    if not np.all(np.isfinite(c)):
        return False
    x, y = c[:, 0], c[:, 1]
    if 0.5 * abs((x * np.roll(y, -1) - np.roll(x, -1) * y).sum()) < 0.01:
        return False
    cross = []
    for i in range(4):
        p, q, r = c[i], c[(i + 1) % 4], c[(i + 2) % 4]
        cross.append((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]))
    if any(abs(v) < 0.001 for v in cross) or (any(v > 0 for v in cross) and any(v < 0 for v in cross)):
        return False
    nl, nr, fr, fl = c
    return bool(fl[1] < nl[1] and fr[1] < nr[1] and nl[0] < nr[0] and fl[0] < fr[0])


def _sharpen(frame: np.ndarray, hm: np.ndarray, scale: float) -> np.ndarray:
    """
    The server has the full frame, so it pulls the phone-size fit onto the
    paint at full size too: one more refine pass, kept only if it explains the
    paint at least as well. A low camera squeezes the far court into a few
    pixels, where every pixel counts.
    """
    h, w = frame.shape[:2]
    up = np.diag([1 / scale, 1 / scale, 1.0]) @ hm
    mask = (line_mask(frame) > 0).astype(np.uint8)
    near = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    step = 2 / scale
    best, rank = up, _rank(_score(up, near, step))
    for band in (2 / scale, 1 / scale):
        nxt = _refine(best, mask, band)
        if nxt is None or not _plausible(nxt[None], w, h)[0]:
            break
        r = _rank(_score(nxt, near, step))
        if r < rank:
            break
        best, rank = nxt, r
    return best


def detect_court(frame: np.ndarray) -> CourtFit | None:
    """Finds the court in one frame. Returns None when nothing fits well enough."""
    h, w = frame.shape[:2]
    if max(h, w) > 960:                                  # full size is only for sharpening; 960 is plenty
        s = 960 / max(h, w)
        frame = cv2.resize(frame, (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)
        h, w = frame.shape[:2]
    scale = ANALYSIS_LONG_SIDE / max(h, w)
    small = cv2.resize(frame, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    found = _detect_small(small)
    if found is None:
        return None
    hm, confidence = found
    if confidence < MIN_FIT_SCORE:
        return None
    if scale < 1:
        hm = _sharpen(frame, hm, sw / w)
        corners = _apply(hm[None], cm.SINGLES_CORNERS_M)[0] / [w, h]
    else:
        corners = _apply(hm[None], cm.SINGLES_CORNERS_M)[0] / [sw, sh]
    return CourtFit(corners=[[float(x), float(y)] for x, y in corners], confidence=round(confidence, 3), source="detected")


def detect_court_in_video(path: str, sample_seconds: list[float] | None = None) -> CourtFit | None:
    """Tries a few frames (players can hide lines) and keeps the best fit."""
    from services.pipeline.video import read_frames, video_info

    info = video_info(path)
    times = sample_seconds or [t for t in (1, 5, 15, 30, 60, 120) if t < max(info.duration, 1)] or [0]
    frames = read_frames(path, [int(t * info.fps) for t in times])
    fits = [f for f in (detect_court(fr) for fr in frames.values()) if f]
    return max(fits, key=lambda f: f.confidence) if fits else None


def from_phone(calibration: dict | list | None) -> CourtFit | None:
    """
    Accepts the phone's four corners: either a plain list of [x, y] in calibration
    order, or the legacy {"pointOrder": [...], "points": [{"x", "y"}]} shape.
    """
    if not calibration:
        return None
    if isinstance(calibration, dict):
        points = calibration.get("points") or calibration.get("corners")
        if not isinstance(points, list):
            return None
        corners = [[float(p["x"]), float(p["y"])] if isinstance(p, dict) else [float(p[0]), float(p[1])] for p in points]
    else:
        corners = [[float(p[0]), float(p[1])] for p in calibration]
    if len(corners) != 4:
        return None
    quad = np.array(corners, dtype=np.float32)
    if cv2.contourArea(quad) < 0.005 or not cv2.isContourConvex(quad):
        return None
    return CourtFit(corners=corners, confidence=1.0, source="phone")
