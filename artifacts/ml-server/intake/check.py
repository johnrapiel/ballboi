"""
Is this recording usable for the Ball Boi test set?

Each check returns findings at one of three levels:
  fix   the recording can't be used as is; ask for a re-record
  note  usable, but worth knowing (or worth telling the friend for next time)
  ok    fine

The verdict is the worst level found. Thresholds are deliberately forgiving:
a false "re-record" costs a friend a match; a false "good" costs one look in
the labeling tool.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np

from intake.metadata import NotAVideo, VideoMeta, read_meta
from services.pipeline.court import detect_court, line_mask
from services.pipeline.video import read_frames

LEVELS = ("ok", "note", "fix")
STABILITY_EVERY = 15.0       # seconds between frames compared for camera movement
VERDICTS = {"ok": "Good", "note": "Usable, with notes", "fix": "Needs a re-record"}


@dataclass
class Finding:
    level: str
    check: str
    message: str            # for John
    ask: str | None = None  # what to tell the friend, if anything


@dataclass
class Review:
    file: str
    verdict: str
    level: str
    findings: list[Finding]
    facts: dict = field(default_factory=dict)
    seconds: float = 0.0

    @property
    def usable_until(self) -> float | None:
        return self.facts.get("usableUntil")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["findings"] = [asdict(f) for f in self.findings]
        return d


def _mmss(seconds: float) -> str:
    seconds = int(seconds)
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}" if seconds >= 3600 \
        else f"{seconds // 60}:{seconds % 60:02d}"


# ─── File ────────────────────────────────────────────────────────────────────

def check_file(meta: VideoMeta) -> list[Finding]:
    out: list[Finding] = []
    w, h = meta.display_size
    if meta.portrait:
        out.append(Finding("fix", "orientation", "Filmed in portrait.",
                           "Please film with the phone sideways (landscape) so the whole court fits."))
    short_side = min(w, h)
    if short_side < 720:
        out.append(Finding("fix", "resolution", f"Low resolution ({w}x{h}).",
                           "Please record at 1080p or higher."))
    elif short_side < 1080:
        out.append(Finding("note", "resolution", f"720p ({w}x{h}); 1080p is better for spotting the ball.",
                           "Record at 1080p if your phone offers it."))
    if meta.fps and meta.fps < 24:
        out.append(Finding("fix", "frame rate", f"Only {meta.fps:g} fps.", "Please record at 60 fps (30 at least)."))
    elif meta.fps and meta.fps < 50:
        out.append(Finding("note", "frame rate", f"{meta.fps:g} fps; 60 fps tracks fast serves better.",
                           "Record at 60 fps if your phone offers it."))
    if meta.hdr:
        out.append(Finding("note", "HDR", f"HDR video ({meta.hdr}); colors can look washed out to the models.",
                           "Turn off HDR video (Settings > Camera > Record Video)."))
    # Phone cameras record 1080p at roughly 0.08 to 0.25 bits per pixel; messaging apps squeeze to well under 0.04.
    if meta.bits_per_pixel and (meta.bits_per_pixel < 0.035 or (short_side >= 1080 and meta.bitrate_mbps < 4)):
        out.append(Finding("fix", "compression",
                           f"Heavily compressed ({meta.bitrate_mbps:.1f} Mbps), likely sent through a messaging app.",
                           "Could you upload the original file straight to the Drive folder? Texting it shrinks the video."))
    if meta.duration and meta.duration < 8 * 60:
        out.append(Finding("note", "length", f"Only {_mmss(meta.duration)} long; a set or two gives more shots.",
                           None))
    return out


# ─── Picture ─────────────────────────────────────────────────────────────────

def _sample_times(duration: float, every: float, limit: int, skip: float = 5.0) -> list[float]:
    if duration <= skip * 2:
        return [duration / 2]
    n = max(2, min(limit, int((duration - 2 * skip) / every) + 1))
    return list(np.linspace(skip, duration - skip, n))


def _small(frame: np.ndarray, width: int = 640) -> np.ndarray:
    h, w = frame.shape[:2]
    return cv2.resize(frame, (width, int(h * width / w))) if w != width else frame


def check_picture(path: str, meta: VideoMeta, frames: dict[float, np.ndarray]) -> tuple[list[Finding], dict]:
    out: list[Finding] = []
    facts: dict = {}
    times = sorted(frames)

    # Lighting
    brightness = [float(cv2.cvtColor(_small(frames[t]), cv2.COLOR_BGR2HSV)[..., 2].mean()) for t in times]
    facts["brightness"] = round(float(np.median(brightness)), 1)
    dark = [t for t, b in zip(times, brightness) if b < 40]
    if len(dark) > 0.5 * len(times):
        out.append(Finding("fix", "lighting", "Too dark for the ball to show up.",
                           "It came out too dark. A lit court or daytime would work much better."))
    elif dark:
        out.append(Finding("note", "lighting", f"Dark stretches (from {_mmss(dark[0])}).", None))

    # Court and framing, from the clearest frames
    fits = []
    for t in times[:: max(1, len(times) // 6)][:6]:
        fit = detect_court(frames[t])
        if fit:
            fits.append((fit.confidence, t, fit))
    if not fits:
        out.append(Finding("note", "court",
                           "I couldn't find the court lines automatically. Check the framing by eye; "
                           "you'll set the corners by hand in the labeling tool anyway.", None))
    else:
        conf, t, fit = max(fits, key=lambda x: x[0])
        facts["court"] = {"corners": fit.corners, "confidence": conf, "at": round(t, 1)}
        corners = np.array(fit.corners)
        near_y = corners[:2, 1].max()
        far_y = corners[2:, 1].min()
        sides = corners[:, 0]
        problems = []
        if near_y > 1.03:
            problems.append("the near baseline is cut off at the bottom")
        if far_y < -0.03:
            problems.append("the far baseline is cut off at the top")
        if sides.min() < -0.03 or sides.max() > 1.03:
            problems.append("a sideline is cut off")
        if problems:
            out.append(Finding("fix", "framing", "Court not fully in frame: " + "; ".join(problems) + ".",
                               "Please frame it so both baselines and both sidelines are in view."))
        width = sides.max() - sides.min()
        if width < 0.35:
            out.append(Finding("note", "framing", "The court looks small in the frame; the far side may be hard to read.",
                               "Mount a little closer so the court fills more of the screen."))
    return out, facts


def check_stability(path: str, meta: VideoMeta, every: float | None = None) -> tuple[list[Finding], dict]:
    """Compares the painted lines between frames: the court shouldn't move if the phone didn't."""
    every = every or STABILITY_EVERY
    times = _sample_times(meta.duration, every, 400)
    fps = meta.fps or 30.0
    frames = read_frames(path, [int(t * fps) for t in times])
    ref = None
    ref_t = None
    moves: list[tuple[float, float]] = []
    window = None
    for t in times:
        f = frames.get(int(t * fps))
        if f is None:
            continue
        m = line_mask(_small(f)).astype(np.float32)
        if m.sum() < 500:                    # too few line pixels to compare (dark, blocked)
            continue
        if ref is None:
            ref, ref_t = m, t
            window = np.outer(np.hanning(m.shape[0]), np.hanning(m.shape[1])).astype(np.float32)
            continue
        (dx, dy), response = cv2.phaseCorrelate(ref, m, window)
        shift = float(np.hypot(dx, dy))
        if response > 0.05 and shift > 4.0:  # pixels at 640 wide
            moves.append((t, shift))
            ref, ref_t = m, t                # compare later frames to the new position
    facts = {"moves": [{"at": round(t, 1), "pixels": round(s, 1)} for t, s in moves]}
    if not moves:
        return [], facts
    first = moves[0][0]
    if first < 0.25 * meta.duration:
        return [Finding("fix", "stability", f"The phone moved at {_mmss(first)} and again later." if len(moves) > 1
                        else f"The phone moved at {_mmss(first)}.",
                        "The phone moved during the match. Please make sure it's firmly mounted and nobody touches it.")], facts
    facts["usableUntil"] = round(first - 5, 1)
    return [Finding("note", "stability",
                    f"The phone moved at {_mmss(first)}; everything before that is usable.",
                    "Keep the phone untouched for the whole match; this one got bumped partway through (the first part is still great).")], facts


def check_ball(path: str, meta: VideoMeta, ball_detector, windows: int = 8, seconds: float = 3.0) -> tuple[list[Finding], dict]:
    """Runs the ball model on short stretches spread through the match."""
    if ball_detector is None or getattr(ball_detector, "name", "") == "motion":
        return [Finding("note", "ball", "Ball check skipped: the ball model isn't installed here.", None)], {}
    fps = meta.fps or 30.0
    span = int(seconds * fps)
    starts = _sample_times(meta.duration - seconds, meta.duration / (windows + 1), windows)
    rates = []
    for s in starts:
        first = int(s * fps)
        frames = read_frames(path, list(range(first, first + span)))
        ordered = [frames[i] for i in sorted(frames)]
        if len(ordered) < 3:
            continue
        seen = 0
        total = 0
        for i in range(0, len(ordered) - 2, 3):
            cands = ball_detector.detect(ordered[i:i + 3])
            seen += sum(1 for c in cands if c)
            total += len(cands)
        if total:
            rates.append(seen / total)
    if not rates:
        return [Finding("note", "ball", "Couldn't run the ball check on this file.", None)], {}
    rates.sort(reverse=True)
    top = rates[: max(1, len(rates) // 2)]       # rallies, not breaks between points
    seen_in_play = float(np.mean(top))
    facts = {"ballSeenInPlay": round(seen_in_play, 2), "windows": [round(r, 2) for r in rates]}
    if seen_in_play < 0.25:
        return [Finding("fix", "ball", f"The ball model barely sees the ball ({seen_in_play:.0%} of rally frames).",
                        "The ball is hard to make out in this one (light, glare, or distance). A brighter court "
                        "or a closer mount would help.")], facts
    if seen_in_play < 0.55:
        return [Finding("note", "ball", f"The ball is seen in {seen_in_play:.0%} of rally frames; "
                        "expect some missed shots.", None)], facts
    return [], facts


# ─── Review ──────────────────────────────────────────────────────────────────

def review(path: str | Path, ball_detector=None) -> Review:
    started = time.time()
    path = str(path)
    name = Path(path).name
    try:
        meta = read_meta(path)
    except NotAVideo as exc:
        return Review(name, VERDICTS["fix"], "fix", [Finding("fix", "file", str(exc),
                      "The file didn't come through as a video. Could you upload it again?")])

    findings = check_file(meta)
    facts: dict = {
        "size": list(meta.display_size), "fps": meta.fps, "duration": round(meta.duration, 1),
        "codec": meta.codec, "hdr": meta.hdr, "bitrateMbps": round(meta.bitrate_mbps, 1),
    }
    cap = cv2.VideoCapture(path)
    readable = cap.isOpened() and cap.read()[0]
    cap.release()
    if not readable:
        findings.append(Finding("fix", "file", "The video won't decode.",
                                "The file seems damaged. Could you upload the original again?"))
    elif not any(f.level == "fix" and f.check in ("orientation", "compression") for f in findings):
        fps = meta.fps or 30.0
        times = _sample_times(meta.duration, 60.0, 24)
        by_index = read_frames(path, [int(t * fps) for t in times])
        frames = {t: by_index[int(t * fps)] for t in times if int(t * fps) in by_index}
        if frames:
            more, extra = check_picture(path, meta, frames)
            findings += more
            facts.update(extra)
            more, extra = check_stability(path, meta)
            findings += more
            facts.update(extra)
            if not any(f.level == "fix" for f in findings):
                more, extra = check_ball(path, meta, ball_detector)
                findings += more
                facts.update(extra)

    level = max((f.level for f in findings), key=LEVELS.index, default="ok")
    return Review(name, VERDICTS[level], level, findings, facts, round(time.time() - started, 1))


def friend_message(r: Review) -> str | None:
    """A short, friendly note to send the person who recorded it. None when nothing needs saying."""
    asks = [f.ask for f in r.findings if f.ask and f.level == "fix"]
    tips = [f.ask for f in r.findings if f.ask and f.level == "note"]
    if not asks and not tips:
        return None
    if asks:
        lines = ["Thanks so much for recording this! A couple of things would make it usable:"] + [f"- {a}" for a in asks]
        if tips:
            lines += ["", "And for next time:"] + [f"- {t}" for t in tips]
        return "\n".join(lines)
    return "\n".join(["Thanks so much for recording this, it works! Small tips for next time:"] + [f"- {t}" for t in tips])
