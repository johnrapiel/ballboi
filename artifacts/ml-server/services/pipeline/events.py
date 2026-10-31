"""
Hits and bounces from the ball track.

A hit or a bounce is a sharp change in the ball's on-screen velocity (a
"kink"). Gravity bends the path smoothly, so it doesn't count. Each kink is
then sorted:
  - hit: the ball is within arm's reach of a player's wrist (from pose), or
    inside their reach box when there are no keypoints. Without a people
    model, a reversal of the ball's up-or-down motion on screen stands in.
    Screen direction alone can't decide it: a high flat serve from the near
    baseline drifts down the screen, and a far shot often rises toward the camera.
  - bounce: any other kink. Its spot on the ground maps exactly to the court.

Rules that fix the common mix-ups:
  - Hits alternate sides. Several candidates in a row for one side (a serve
    toss and the contact, or a bounce in front of the player and the hit) keep
    the one closest to the racket while the ball is still arriving, then the
    one that gains the most speed.
  - Hits more than RALLY_GAP seconds apart start a new rally; the first hit of
    a rally is the serve.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from services import court_model as cm
from services.pipeline.ball import BallTrack
from services.pipeline.players import L_WRIST, R_WRIST, Players

RALLY_GAP = 3.0          # seconds between hits that splits rallies
SAME_SIDE_WINDOW = 1.2   # seconds: a toss and its contact, or a bounce and the hit after it
MIN_EVENT_SPACING = 0.12  # seconds between two kinks
KINK_WINDOW = 0.10       # seconds of track on each side used to measure a kink
KINK_THRESHOLD = 0.55    # relative velocity change that counts as a kink


@dataclass
class Kink:
    frame: int
    strength: float
    v_before: np.ndarray
    v_after: np.ndarray


@dataclass
class Hit:
    frame: int
    side: str                     # near | far
    rally: int = 0
    bounce_frame: int | None = None
    bounce_image: tuple[float, float] | None = None   # normalized
    bounce_court: tuple[float, float] | None = None
    landed_on_own_side: bool = False                  # bounced before crossing: net
    long_past_near_baseline: bool = False             # left the frame behind the near baseline
    evidence: dict = field(default_factory=dict)


def _smooth(track: BallTrack, window: int) -> np.ndarray:
    xy = track.xy.copy()
    if window <= 1:
        return xy
    out = xy.copy()
    half = window // 2
    vis = ~np.isnan(xy[:, 0])
    for i in np.where(vis)[0]:
        lo, hi = max(0, i - half), min(len(xy), i + half + 1)
        seg = xy[lo:hi][vis[lo:hi]]
        out[i] = seg.mean(axis=0)
    return out


def find_kinks(track: BallTrack, fps: float, frame_h: int) -> list[Kink]:
    k = max(2, int(round(KINK_WINDOW * fps)))
    xy = _smooth(track, 3 if fps >= 50 else 1)
    n = len(xy)
    vis = ~np.isnan(xy[:, 0])
    min_speed = 0.003 * frame_h         # px per frame; far-court shots move only a pixel or two
    raw = []
    for i in range(2, n - 2):
        if not vis[i]:
            continue
        # Up to k frames each side; at least 2, so a bounce right before the ball
        # leaves the frame (a long ball past the near baseline) still counts.
        kb = next((j for j in range(min(k, i), 1, -1) if vis[i - j]), None)
        ka = next((j for j in range(min(k, n - 1 - i), 1, -1) if vis[i + j]), None)
        if kb is None or ka is None:
            continue
        vb = (xy[i] - xy[i - kb]) / kb
        va = (xy[i + ka] - xy[i]) / ka
        fastest = max(np.linalg.norm(vb), np.linalg.norm(va))
        if fastest < min_speed:
            continue
        strength = float(np.linalg.norm(va - vb) / fastest)
        if strength >= KINK_THRESHOLD:
            raw.append(Kink(i, strength, vb, va))
    # Keep the strongest kink in each neighborhood.
    spacing = max(1, int(round(MIN_EVENT_SPACING * fps)))
    kept: list[Kink] = []
    for kink in sorted(raw, key=lambda q: -q.strength):
        if all(abs(kink.frame - other.frame) > spacing for other in kept):
            kept.append(kink)
    return sorted(kept, key=lambda q: q.frame)


REACH = 0.45            # ball within this many body-heights of a wrist counts as at the racket


def _reach_box(person, frame_shape) -> tuple[float, float, float, float] | None:
    """Without keypoints: the area around a player's box a racket can cover."""
    if person is None:
        return None
    x1, y1, x2, y2 = person.box
    w, h = x2 - x1, y2 - y1
    return (x1 - 0.9 * w, y1 - 0.6 * h, x2 + 0.9 * w, y2 + 0.1 * h)


def _inside(box, p) -> bool:
    return box is not None and box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]


def reach(person, p, frame_shape) -> float | None:
    """
    How far the ball is from this player's racket hand, in body-heights. Uses the
    wrists when pose is available; otherwise 0 inside the reach box, None outside.
    """
    if person is None:
        return None
    wrists = [w for w in (person.point(L_WRIST), person.point(R_WRIST)) if w is not None]
    if wrists:
        d = min(float(np.hypot(*(np.asarray(p) - w))) for w in wrists) / max(person.height_px, 1.0)
        return d if d <= REACH else None
    return 0.0 if _inside(_reach_box(person, frame_shape), p) else None


def _launch(kink: Kink) -> float:
    """
    Speed the ball gains at the kink. A hit adds the most; a serve toss leaving
    the hand adds less than the serve itself; a bounce takes speed away.
    """
    return float(np.linalg.norm(kink.v_after) - np.linalg.norm(kink.v_before))


def _leaving_penalty(kink: Kink, side: str) -> float:
    """
    At contact the ball is still arriving: moving up the screen into the far player,
    down the screen into the near one. A small player on screen stays "within reach"
    for a few frames after the ball leaves; this keeps those frames from winning.
    """
    arriving = kink.v_before[1] < 0 if side == "far" else kink.v_before[1] > 0
    return 0.0 if arriving else 0.2


def classify_kinks(kinks: list[Kink], track: BallTrack, fps: float, frame_shape: tuple[int, int],
                   image_to_court: np.ndarray, players_at: dict[int, Players] | None) -> tuple[list[Hit], list[Kink]]:
    """Splits kinks into hits (with side) and bounces."""
    candidates: list[tuple[Kink, str, float]] = []
    bounces: list[Kink] = []
    for kink in kinks:
        p = track.xy[kink.frame]
        side, closeness = None, 0.0
        players = (players_at or {}).get(kink.frame)
        if players is not None:
            near_d = reach(players.near, p, frame_shape)
            # A near hit sends the ball up the screen, or (a high flat serve) at least speeds it up.
            # A ball bouncing past the near player keeps coming down the screen and slows.
            if near_d is not None and not (kink.v_after[1] < 0 or _launch(kink) > 0):
                near_d = None
            options = [(d, s) for s, d in (("near", near_d), ("far", reach(players.far, p, frame_shape)))
                       if d is not None]
            if options:
                closeness, side = min(options)
        else:
            if kink.v_before[1] > 0 and kink.v_after[1] < 0:
                side = "near"
            elif kink.v_before[1] < 0 and kink.v_after[1] > 0:
                side = "far"
        if side is None:
            bounces.append(kink)
        else:
            candidates.append((kink, side, closeness))

    # Hits alternate sides. A run of candidates for one side (a serve toss and the
    # contact, or a bounce in front of the player and the hit) keeps the one closest
    # to the racket while the ball is still arriving, then the one gaining the most speed.
    hits: list[Hit] = []
    run: list[tuple[Kink, float]] = []
    run_side = None

    def flush():
        if not run:
            return
        best, closeness = min(run, key=lambda kc: (round(kc[1] + _leaving_penalty(kc[0], run_side), 2),
                                                   -_launch(kc[0])))
        hits.append(Hit(frame=best.frame, side=run_side,
                        evidence={"kink": round(best.strength, 3), "launch": round(_launch(best), 2),
                                  "reach": round(closeness, 3)}))
        bounces.extend(k for k, _ in run if k is not best)

    for kink, side, closeness in candidates:
        if run and (side != run_side or (kink.frame - run[0][0].frame) / fps > SAME_SIDE_WINDOW):
            flush()
            run = []
        run_side = side
        run.append((kink, closeness))
    flush()
    bounces.sort(key=lambda k: k.frame)

    rally = 0
    for i, hit in enumerate(hits):
        if i and (hit.frame - hits[i - 1].frame) / fps > RALLY_GAP:
            rally += 1
        hit.rally = rally
    return hits, bounces


def _bounce_score(kink: Kink) -> float:
    """Strong kinks first; a ball that was falling on screen and now rises is the bounce signature."""
    flip = kink.v_before[1] > 0 and kink.v_after[1] < 0
    return kink.strength + (0.5 if flip else 0.0)


def attach_bounces(hits: list[Hit], bounces: list[Kink], track: BallTrack, fps: float,
                   frame_shape: tuple[int, int], image_to_court: np.ndarray) -> None:
    """
    For each hit, the bounce that ends its flight. A kink while the ball is still
    in the air maps beyond where the ball really is (the ground point behind it
    on the camera's line of sight), so implausible spots are dropped first.
    """
    h, w = frame_shape
    for i, hit in enumerate(hits):
        end = hits[i + 1].frame if i + 1 < len(hits) and hits[i + 1].rally == hit.rally else hit.frame + int(3 * fps)
        placed = []
        for b in bounces:
            if not hit.frame < b.frame < end:
                continue
            px = track.xy[b.frame]
            norm = (float(px[0] / w), float(px[1] / h))
            cx, cy = cm.apply_homography(image_to_court, [norm])[0]
            if abs(cx) > cm.DOUBLES_HALF_WIDTH + 3.0 or abs(cy) > cm.HALF_LENGTH + 3.0:
                continue
            placed.append((b, norm, (float(cx), float(cy))))
        if not placed:
            if hit.side == "far":
                hit.long_past_near_baseline = _left_frame_long(track, hit.frame, end, frame_shape, image_to_court)
            continue
        receiver_half = [q for q in placed if (q[2][1] > 0) == (hit.side == "near")]
        if receiver_half:
            b, norm, court = max(receiver_half, key=lambda q: _bounce_score(q[0]))
        else:
            b, norm, court = max(placed, key=lambda q: _bounce_score(q[0]))
            hit.landed_on_own_side = True
        hit.bounce_frame = b.frame
        hit.bounce_image = norm
        hit.bounce_court = court


def _left_frame_long(track: BallTrack, start: int, end: int, frame_shape, image_to_court) -> bool:
    """
    A ball heading to the near side that leaves the frame without a seen bounce.
    An airborne ball's ground projection always lands farther from the camera
    than the ball really is, so if the last sighting already projects behind the
    near baseline while the ball is dropping, it can only land out.
    """
    h, w = frame_shape
    seen = [i for i in range(start + 1, min(end, len(track))) if not np.isnan(track.xy[i, 0])]
    if len(seen) < 3:
        return False
    last, before = seen[-1], seen[-3]
    if track.xy[last, 1] <= track.xy[before, 1]:          # must be coming down the screen
        return False
    if track.xy[last, 1] < 0.9 * h:                      # and actually leaving at the bottom
        return False
    _, cy = cm.apply_homography(image_to_court, [(track.xy[last, 0] / w, track.xy[last, 1] / h)])[0]
    return cy < -cm.HALF_LENGTH - 0.1


def find_events(track: BallTrack, fps: float, frame_shape: tuple[int, int], image_to_court: np.ndarray,
                players_at: dict[int, Players] | None = None) -> list[Hit]:
    kinks = find_kinks(track, fps, frame_shape[0])
    hits, bounces = classify_kinks(kinks, track, fps, frame_shape, image_to_court, players_at)
    attach_bounces(hits, bounces, track, fps, frame_shape, image_to_court)
    return hits


def candidate_frames(track: BallTrack, fps: float, frame_h: int) -> list[int]:
    """Frames where a hit might be, so the people model only runs where it matters."""
    return [k.frame for k in find_kinks(track, fps, frame_h)]
