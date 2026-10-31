"""
Scores pipeline predictions against the labeled test set.

Every stat is scored against *all* labeled examples it applies to, so a shot
the pipeline missed counts as wrong. That keeps detection quality inside each
number instead of hiding it.

Gated stats (have a launch bar in bars.json):
  shot_type          share of labeled shots whose type was predicted correctly
  close_call_in_out  share of labeled close calls whose in/out was called correctly
  serve_placement    share of labeled in-serves whose lane (deuce/ad x wide/body/T) was right

Reported, no bar yet:
  shot_detection_recall / precision, hitter, in_out (all), point_ending,
  rally_length_mae, first_serve_pct_error, landing_error_m, close_call_flagged
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Callable, Iterable

from services import court_model
from evaluation.schema import MatchFile, Shot, split_points

DEFAULT_TIME_TOLERANCE = 0.25   # seconds between labeled and predicted contact
DEFAULT_CLOSE_CALL_METERS = 0.10


@dataclass
class Tally:
    correct: int = 0
    total: int = 0

    def add(self, ok: bool) -> None:
        self.total += 1
        self.correct += int(ok)

    def merge(self, other: "Tally") -> None:
        self.correct += other.correct
        self.total += other.total

    @property
    def rate(self) -> float | None:
        return self.correct / self.total if self.total else None

    def wilson(self, z: float = 1.96) -> tuple[float, float] | None:
        """95% confidence interval for the rate."""
        n = self.total
        if not n:
            return None
        p = self.correct / n
        denom = 1 + z * z / n
        center = (p + z * z / (2 * n)) / denom
        half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
        return max(0.0, center - half), min(1.0, center + half)


@dataclass
class MatchScore:
    match_id: str
    conditions: dict[str, str]
    tallies: dict[str, Tally] = field(default_factory=dict)
    errors: dict[str, list[float]] = field(default_factory=dict)
    confusion: dict[str, dict[tuple[str, str], int]] = field(default_factory=dict)

    def tally(self, name: str) -> Tally:
        return self.tallies.setdefault(name, Tally())

    def error(self, name: str, value: float) -> None:
        self.errors.setdefault(name, []).append(value)

    def confuse(self, name: str, truth: str, predicted: str) -> None:
        table = self.confusion.setdefault(name, {})
        table[(truth, predicted)] = table.get((truth, predicted), 0) + 1


# ─── Matching ────────────────────────────────────────────────────────────────

def match_shots(labels: list[Shot], predictions: list[Shot],
                tolerance: float = DEFAULT_TIME_TOLERANCE) -> dict[int, int]:
    """
    Pair each labeled shot with at most one predicted shot by contact time.
    Closest pairs win first, so a nearby extra prediction can't steal a match.
    Returns {label_index: prediction_index}.
    """
    candidates = []
    for li, ls in enumerate(labels):
        for pi, ps in enumerate(predictions):
            dt = abs(ls.time - ps.time)
            if dt <= tolerance:
                candidates.append((dt, li, pi))
    candidates.sort()
    used_l: set[int] = set()
    used_p: set[int] = set()
    pairs: dict[int, int] = {}
    for _, li, pi in candidates:
        if li in used_l or pi in used_p:
            continue
        pairs[li] = pi
        used_l.add(li)
        used_p.add(pi)
    return pairs


# ─── Helpers ─────────────────────────────────────────────────────────────────

def is_close_call(shot: Shot, close_call_meters: float) -> bool:
    """A labeled close call: flagged by the labeler, or landing within the distance of the deciding line."""
    if shot.close_call:
        return True
    if shot.result not in ("in", "out") or not shot.bounce or not shot.bounce.court:
        return False
    x, y = shot.bounce.court
    d = court_model.line_call_distance(x, y, shot.hitter, shot.is_serve)
    return abs(d) <= close_call_meters


def landing_zone(shot: Shot) -> str | None:
    if not shot.is_serve or shot.result != "in" or not shot.bounce or not shot.bounce.court:
        return None
    return court_model.serve_zone(*shot.bounce.court)


# ─── Scoring one match ───────────────────────────────────────────────────────

def score_match(label: MatchFile, prediction: MatchFile | None,
                tolerance: float = DEFAULT_TIME_TOLERANCE,
                close_call_meters: float = DEFAULT_CLOSE_CALL_METERS) -> MatchScore:
    score = MatchScore(match_id=label.match_id, conditions=dict(label.conditions))
    pred_shots = prediction.shots if prediction else []
    pairs = match_shots(label.shots, pred_shots, tolerance)

    # Detection
    score.tally("shot_detection_recall").correct += len(pairs)
    score.tally("shot_detection_recall").total += len(label.shots)
    score.tally("shot_detection_precision").correct += len(pairs)
    score.tally("shot_detection_precision").total += len(pred_shots)

    for li, ls in enumerate(label.shots):
        ps = pred_shots[pairs[li]] if li in pairs else None

        score.tally("shot_type").add(ps is not None and ps.type == ls.type)
        score.confuse("shot_type", ls.type, ps.type if ps else "missed")
        if ps is not None:
            score.tally("hitter").add(ps.hitter == ls.hitter)
            score.error("contact_time_error_s", abs(ps.time - ls.time))

        # In / out: only shots whose landing the labeler saw.
        if ls.result in ("in", "out"):
            predicted_result = ps.result if ps else "missed"
            # "net" means the ball never crossed, which is also out.
            called = {"net": "out"}.get(predicted_result, predicted_result)
            ok = called == ls.result
            score.tally("in_out").add(ok)
            if is_close_call(ls, close_call_meters):
                score.tally("close_call_in_out").add(ok)
                score.tally("close_call_flagged").add(bool(ps and ps.close_call))
                score.confuse("close_call_in_out", ls.result, called)
            if ps is not None and not ok and predicted_result in ("in", "out", "net"):
                # A wrong call shown as fact is the worst outcome; track how often it was flagged.
                score.tally("wrong_calls_flagged").add(bool(ps.close_call))

        # Landing spot error, for heatmaps.
        if (ps is not None and ls.bounce and ls.bounce.court and ps.bounce and ps.bounce.court):
            score.error("landing_error_m", math.dist(ls.bounce.court, ps.bounce.court))

        # Serve placement.
        truth_zone = landing_zone(ls)
        if truth_zone is not None:
            predicted_zone = landing_zone(ps) if ps is not None else None
            score.tally("serve_placement").add(predicted_zone == truth_zone)
            score.confuse("serve_placement", truth_zone, predicted_zone or "none")

    # Points: pair labeled points with predicted shots by the point's last shot.
    for point in split_points(label.shots):
        last_index = label.shots.index(point.shots[-1])
        ps = pred_shots[pairs[last_index]] if last_index in pairs else None
        truth = point.ending
        predicted = ps.point_end if ps else None
        score.tally("point_ending").add(predicted == truth)
        score.confuse("point_ending", truth or "none", predicted or "none")

    label_points = split_points(label.shots)
    pred_points = split_points(pred_shots)
    if label_points and pred_points:
        pt = [p.end_time for p in pred_points]
        for lp in label_points:
            # nearest predicted point ending within 2 seconds
            j = min(range(len(pt)), key=lambda k: abs(pt[k] - lp.end_time))
            if abs(pt[j] - lp.end_time) <= 2.0:
                score.error("rally_length_abs_error", abs(pred_points[j].rally_length - lp.rally_length))

    truth_fs = [p.first_serve_in for p in label_points if p.first_serve_in is not None]
    pred_fs = [p.first_serve_in for p in pred_points if p.first_serve_in is not None]
    if truth_fs and pred_fs:
        score.error(
            "first_serve_pct_error",
            abs(100 * sum(truth_fs) / len(truth_fs) - 100 * sum(pred_fs) / len(pred_fs)),
        )
    return score


# ─── Aggregation ─────────────────────────────────────────────────────────────

@dataclass
class StatResult:
    name: str
    tally: Tally
    bar: float | None
    by_condition: dict[str, dict[str, Tally]]

    @property
    def rate(self) -> float | None:
        return self.tally.rate

    @property
    def meets_bar(self) -> bool | None:
        if self.bar is None or self.rate is None:
            return None
        return self.rate >= self.bar


@dataclass
class Summary:
    matches: list[MatchScore]
    stats: dict[str, StatResult]
    errors: dict[str, dict[str, float]]
    confusion: dict[str, dict[tuple[str, str], int]]
    unscored_labels: list[str]
    unlabeled_predictions: list[str]
    label_sources: dict[str, int] = field(default_factory=dict)


RATE_STATS = (
    "shot_type", "close_call_in_out", "serve_placement",
    "shot_detection_recall", "shot_detection_precision", "hitter",
    "in_out", "point_ending", "close_call_flagged", "wrong_calls_flagged",
)


def _describe(values: list[float]) -> dict[str, float]:
    return {
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p90": sorted(values)[max(0, math.ceil(0.9 * len(values)) - 1)],
        "count": float(len(values)),
    }


def summarize(labels: dict[str, MatchFile], predictions: dict[str, MatchFile],
              bars: dict[str, float],
              tolerance: float = DEFAULT_TIME_TOLERANCE,
              close_call_meters: float = DEFAULT_CLOSE_CALL_METERS,
              include: Callable[[MatchFile], bool] = lambda m: m.status == "done") -> Summary:
    scored: list[MatchScore] = []
    unscored = []
    for match_id, label in sorted(labels.items()):
        if not include(label):
            unscored.append(match_id)
            continue
        scored.append(score_match(label, predictions.get(match_id), tolerance, close_call_meters))

    stats: dict[str, StatResult] = {}
    for name in RATE_STATS:
        total = Tally()
        by_condition: dict[str, dict[str, Tally]] = {}
        for ms in scored:
            t = ms.tallies.get(name)
            if not t:
                continue
            total.merge(t)
            for key, value in ms.conditions.items():
                by_condition.setdefault(key, {}).setdefault(value, Tally()).merge(t)
        stats[name] = StatResult(name, total, bars.get(name), by_condition)

    errors: dict[str, list[float]] = {}
    confusion: dict[str, dict[tuple[str, str], int]] = {}
    for ms in scored:
        for name, values in ms.errors.items():
            errors.setdefault(name, []).extend(values)
        for name, table in ms.confusion.items():
            agg = confusion.setdefault(name, {})
            for k, v in table.items():
                agg[k] = agg.get(k, 0) + v

    sources: dict[str, int] = {}
    for match_id, label in labels.items():
        if include(label):
            for shot in label.shots:
                sources[shot.source] = sources.get(shot.source, 0) + 1
    return Summary(
        label_sources=sources,
        matches=scored,
        stats=stats,
        errors={k: _describe(v) for k, v in errors.items() if v},
        confusion=confusion,
        unscored_labels=unscored,
        unlabeled_predictions=sorted(set(predictions) - set(labels)),
    )


def gated(summary: Summary) -> Iterable[StatResult]:
    return (s for s in summary.stats.values() if s.bar is not None)
