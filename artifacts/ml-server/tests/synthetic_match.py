"""
A synthetic singles match for end-to-end tests: rendered through a pinhole
camera mounted behind the near baseline, with gravity, bounces, a serve toss,
faults, volleys, an overhead, outs and winners, plus its ground-truth label file.

Players are drawn as colored billboards (near blue, far red) with a magenta
racket wrist, and ColorPeople finds them by color. That stands in for the
person and pose models, which need weights this repo doesn't carry.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from services import court_model as cm
from services.pipeline.players import L_WRIST, NOSE, R_WRIST, L_SHOULDER, R_SHOULDER, Person

W, H, FPS = 640, 360, 30.0
G = 9.81
NEAR_COLOR = (200, 90, 40)     # BGR
FAR_COLOR = (40, 40, 200)
WRIST_COLOR = (200, 0, 200)


class Camera:
    def __init__(self, pos=(0.0, -cm.HALF_LENGTH - 5.0, 3.5), target=(0.0, -1.0, 0.0), f=330.0):
        self.c = np.array(pos, dtype=float)
        fwd = np.array(target, dtype=float) - self.c
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, [0, 0, 1.0])
        right /= np.linalg.norm(right)
        down = np.cross(fwd, right)
        self.r = np.stack([right, down, fwd])
        self.f = f

    def project(self, p) -> tuple[float, float, float]:
        pc = self.r @ (np.asarray(p, dtype=float) - self.c)
        return self.f * pc[0] / pc[2] + W / 2, self.f * pc[1] / pc[2] + H / 2, pc[2]

    def corners(self) -> list[list[float]]:
        out = []
        for x, y in cm.SINGLES_CORNERS_M:
            u, v, _ = self.project((x, y, 0))
            out.append([u / W, v / H])
        return out


@dataclass
class TruthShot:
    time: float
    hitter: str
    type: str
    contact: tuple[float, float, float]
    target: tuple[float, float]
    flight: float
    serve_number: int | None = None
    result: str = "in"
    point_end: str | None = None
    after_bounce: float = 0.55        # seconds until the next contact (or end of the clip)
    volleyed: bool = False            # the next player hits it before it lands


@dataclass
class Scene:
    shots: list[TruthShot] = field(default_factory=list)
    duration: float = 0.0


def _ball_position(shot: TruthShot, t: float):
    """Ball position t seconds after contact, or None if it's out of play."""
    x0, y0, z0 = shot.contact
    tx, ty = shot.target
    T = shot.flight
    vx, vy = (tx - x0) / T, (ty - y0) / T
    vz = (G * T * T / 2 - z0) / T
    if t <= T or shot.volleyed:
        return (x0 + vx * t, y0 + vy * t, max(0.0, z0 + vz * t - G * t * t / 2))
    if shot.result == "net":
        return None
    tb = t - T
    vz_up = 0.7 * abs(vz - G * T)
    return (tx + 0.55 * vx * tb, ty + 0.55 * vy * tb, max(0.0, vz_up * tb - G * tb * tb / 2))


def build_scene() -> Scene:
    """Four points: an ace, a fault then a rally to a winner, a rally ending long, and serve and volley."""
    s = Scene()
    t = 1.5

    def add(shot: TruthShot) -> TruthShot:
        s.shots.append(shot)
        return shot

    def rally(start_t, hitter, contact, plan, serve_number=1):
        """plan: list of (type, target, flight, result, point_end, after, volleyed)."""
        nonlocal t
        tt = start_t
        side = hitter
        c = contact
        last = None
        for i, (kind, target, flight, result, end, after, volleyed) in enumerate(plan):
            shot = add(TruthShot(tt, side, kind, c, target, flight,
                                 serve_number if kind == "serve" else None, result, end, after, volleyed))
            last = shot
            if end or (kind == "serve" and result != "in" and i == len(plan) - 1):
                break
            dt = flight if volleyed else flight + after
            nxt = _ball_position(shot, flight * 0.75 if volleyed else dt)
            c = (nxt[0], nxt[1], nxt[2] if not volleyed else max(1.0, nxt[2]))
            if volleyed:
                dt = flight * 0.75
            tt += dt
            side = cm.other_side(side)
        t = tt + last.flight + 6.0          # players reset between points

    near_deuce = (1.2, -cm.HALF_LENGTH - 0.2, 2.6)
    near_ad = (-1.2, -cm.HALF_LENGTH - 0.2, 2.6)
    far_deuce = (-1.2, cm.HALF_LENGTH + 0.2, 2.6)

    # 1. Ace, near server, wide in the deuce box (far receiver's deuce box is image-left).
    rally(t, "near", near_deuce, [("serve", (-3.6, 5.6), 0.62, "in", "winner", 0.9, False)])
    # 2. Fault long, then a second-serve rally: backhand return, forehand, forehand winner.
    rally(t, "near", near_ad, [("serve", (1.8, 7.3), 0.65, "out", None, 0.5, False)], serve_number=1)
    rally(t, "near", near_ad, [
        ("serve", (2.2, 5.0), 0.7, "in", None, 0.45, False),
        ("backhand", (-1.5, -8.5), 1.0, "in", None, 0.35, False),
        ("forehand", (2.5, 8.5), 1.0, "in", None, 0.35, False),
        ("backhand", (-3.0, -8.0), 0.95, "in", "winner", 0.9, False),
    ], serve_number=2)
    # 3. Far server; return, then a forehand long.
    rally(t, "far", far_deuce, [
        ("serve", (1.0, -5.0), 0.7, "in", None, 0.45, False),
        ("forehand", (0.5, 8.8), 1.05, "in", None, 0.35, False),
        ("forehand", (1.0, -12.6), 1.0, "out", "unforced_error", 0.9, False),
    ])
    # 4. Serve and volley: the near player volleys the return for a winner.
    rally(t, "near", near_deuce, [
        ("serve", (-2.4, 5.2), 0.65, "in", None, 0.45, False),
        ("backhand", (0.5, -8.0), 0.9, "none", None, 0.5, True),
        ("volley", (3.2, 8.5), 0.7, "in", "winner", 0.9, False),
    ])
    s.duration = t + 1.0
    return s


def render(scene: Scene, path: str, camera: Camera | None = None) -> Camera:
    cam = camera or Camera()
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), FPS, (W, H))
    n = int(scene.duration * FPS)
    base = np.full((H, W, 3), (70, 120, 60), np.uint8)
    for (a, b) in cm.COURT_LINES_M[:-1] + (
        ((-cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH), (-cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH)),
        ((cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH), (cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH)),
    ):
        pa, pb = cam.project((*a, 0)), cam.project((*b, 0))
        cv2.line(base, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), (235, 235, 235), 2, cv2.LINE_AA)
    net_a, net_b = cam.project((-cm.DOUBLES_HALF_WIDTH, 0, 0.914)), cam.project((cm.DOUBLES_HALF_WIDTH, 0, 0.914))
    cv2.line(base, (int(net_a[0]), int(net_a[1])), (int(net_b[0]), int(net_b[1])), (40, 40, 40), 2)

    for i in range(n):
        t = i / FPS
        img = base.copy()
        draws = []
        for side in ("far", "near"):
            pos, wrist_up = _player_state(scene, side, t)
            draws.append((side, pos, wrist_up))
        ball = _ball_at(scene, t)
        for side, pos, wrist_up in draws:          # far first, so the near player is drawn on top
            _draw_player(img, cam, side, pos, wrist_up, ball)
        if ball is not None:
            u, v, depth = cam.project(ball)
            r = max(2, int(round(cam.f * 0.04 / depth)))
            cv2.circle(img, (int(round(u)), int(round(v))), r, (40, 230, 235), -1, cv2.LINE_AA)
        writer.write(img)
    writer.release()
    return cam


def _ball_at(scene: Scene, t: float):
    current = None
    for shot in scene.shots:
        start = shot.time - (0.9 if shot.type == "serve" else 0.0)
        if shot.time - (0.9 if shot.type == "serve" else 0) <= t:
            current = shot
    if current is None:
        return None
    if current.type == "serve" and t < current.time:
        # Toss: up from the hand to about 3 m, down to the contact height.
        x, y, z = current.contact
        u = (t - (current.time - 0.9)) / 0.9
        return (x, y, 1.2 + (z - 1.2) * u + 3.0 * u * (1 - u))
    dt = t - current.time
    nxt = next((s for s in scene.shots if s.time > current.time), None)
    if nxt is not None and t >= nxt.time - 1e-9:
        return None
    end = current.flight + (0.6 if not nxt or nxt.time - current.time > 3 else 99)
    if dt > end:
        return None
    return _ball_position(current, dt)


def _contact_offset(shot: TruthShot) -> float:
    """Where the player stands across the court relative to the ball at contact."""
    if shot.type in ("serve", "overhead"):
        return -0.35 if shot.hitter == "near" else 0.35
    if shot.type == "volley":
        return -0.6 if shot.hitter == "near" else 0.6
    # Right-handers: near player's forehand is on their right (+x), far player's on their right (-x).
    sign = 1.0 if shot.type == "forehand" else -1.0
    return -0.75 * sign if shot.hitter == "near" else 0.75 * sign


def _player_state(scene: Scene, side: str, t: float):
    mine = [s for s in scene.shots if s.hitter == side]
    default = (0.0, -cm.HALF_LENGTH - 0.5 if side == "near" else cm.HALF_LENGTH + 0.5)
    if not mine:
        return default, False
    nxt = next((s for s in mine if s.time >= t - 0.25), None)
    prev = [s for s in mine if s.time < t - 0.25]
    target = (nxt.contact[0] + _contact_offset(nxt), nxt.contact[1]) if nxt else default
    origin = (prev[-1].contact[0] + _contact_offset(prev[-1]), prev[-1].contact[1]) if prev else target
    if nxt is None:
        return origin, False
    span = max(0.5, nxt.time - (prev[-1].time if prev else nxt.time - 1))
    u = min(1.0, max(0.0, 1 - (nxt.time - t) / span))
    pos = (origin[0] + (target[0] - origin[0]) * u, origin[1] + (target[1] - origin[1]) * u)
    wrist_up = nxt.type in ("serve", "overhead") and abs(nxt.time - t) < 0.4
    # Around contact the racket wrist meets the ball (a forearm short of it).
    if abs(nxt.time - t) < 0.12:
        bx, by, bz = nxt.contact
        return pos, (bx + (pos[0] - bx) * 0.4, by, bz - 0.1)
    return pos, wrist_up


def _draw_player(img, cam, side, pos, wrist_up, ball):
    x, y = pos
    pts = [cam.project((x + dx, y, z)) for dx, z in ((-0.3, 0), (0.3, 0), (0.3, 1.8), (-0.3, 1.8))]
    poly = np.array([[p[0], p[1]] for p in pts], np.int32)
    cv2.fillConvexPoly(img, poly, NEAR_COLOR if side == "near" else FAR_COLOR)
    # Racket wrist: at the ball around contact; otherwise on the right side (near: +x,
    # far: -x) at waist height, or above the head for a serve.
    if isinstance(wrist_up, tuple):
        u, v, depth = cam.project(wrist_up)
    else:
        wx = x + (0.35 if side == "near" else -0.35)
        wz = 2.15 if wrist_up else 1.0
        u, v, depth = cam.project((wx, y, wz))
    cv2.circle(img, (int(u), int(v)), max(2, int(cam.f * 0.05 / depth)), WRIST_COLOR, -1)


class ColorPeople:
    """Finds the rendered players and their racket wrist by color."""
    name = "synthetic-color-people"

    def __call__(self, frame: np.ndarray) -> list[Person]:
        out = []
        for color, side in ((NEAR_COLOR, "near"), (FAR_COLOR, "far")):
            mask = cv2.inRange(frame, np.array(color) - 25, np.array(color) + 25)
            n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
            if n < 2:
                continue
            k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            x, y, w, h = stats[k, :4]
            box = np.array([x, y, x + w, y + h], dtype=np.float32)
            kp = np.zeros((17, 2), np.float32)
            sc = np.zeros(17, np.float32)
            kp[NOSE] = [x + w / 2, y + 0.06 * h]
            kp[L_SHOULDER] = [x + 0.2 * w, y + 0.2 * h]
            kp[R_SHOULDER] = [x + 0.8 * w, y + 0.2 * h]
            sc[[NOSE, L_SHOULDER, R_SHOULDER]] = 0.9
            wm = cv2.inRange(frame, np.array(WRIST_COLOR) - 30, np.array(WRIST_COLOR) + 30)
            ys, xs = np.where(wm[max(0, y - h): y + h, max(0, x - w): x + 2 * w] > 0)
            if len(xs):
                wx, wy = xs.mean() + max(0, x - w), ys.mean() + max(0, y - h)
                racket = R_WRIST if side == "near" else L_WRIST   # far player faces the camera
                other = L_WRIST if racket == R_WRIST else R_WRIST
                kp[racket] = [wx, wy]
                kp[other] = [x + w / 2, y + 0.5 * h]
                sc[[racket, other]] = 0.9
            out.append(Person(box=box, keypoints=kp, scores=sc))
        return out


def truth_label(scene: Scene, cam: Camera, match_id: str = "synthetic") -> dict:
    shots = []
    for i, s in enumerate(scene.shots):
        bounce = None
        if s.result in ("in", "out"):
            u, v, _ = cam.project((*s.target, 0))
            bounce = {"time": round(s.time + s.flight, 3), "image": [u / W, v / H], "court": list(s.target)}
        shots.append({
            "id": f"t{i + 1:04d}", "time": round(s.time, 3), "hitter": s.hitter, "type": s.type,
            "serveNumber": s.serve_number, "bounce": bounce, "result": s.result,
            "closeCall": False, "pointEnd": s.point_end,
        })
    return {"schemaVersion": 1, "matchId": match_id, "status": "done",
            "conditions": {"venue": "synthetic", "lighting": "day"},
            "calibrations": [{"fromTime": 0.0, "corners": cam.corners()}], "shots": shots}
