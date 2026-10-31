"""Eval harness: label format, shot matching, per-stat scoring, bars, and regressions."""
import copy
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from evaluation import metrics, report  # noqa: E402
from evaluation.__main__ import main  # noqa: E402
from evaluation.schema import LabelError, parse_match, split_points  # noqa: E402

EXAMPLE = Path(__file__).resolve().parent.parent / "evaluation" / "labels" / "_example.json"
BARS = {"shot_type": 0.90, "close_call_in_out": 0.85, "serve_placement": 0.85}


def example() -> dict:
    return json.loads(EXAMPLE.read_text())


def as_prediction(raw: dict, **shot_changes) -> dict:
    p = copy.deepcopy(raw)
    p["model"] = {"version": "test-model"}
    for shot in p["shots"]:
        shot.update(shot_changes.get(shot["id"], {}))
    return p


def summary_for(label: dict, prediction: dict | None):
    labels = {label["matchId"]: parse_match(label)}
    preds = {prediction["matchId"]: parse_match(prediction)} if prediction else {}
    return metrics.summarize(labels, preds, BARS)


# ─── Format ──────────────────────────────────────────────────────────────────

def test_example_label_parses():
    m = parse_match(example())
    assert len(m.shots) == 4
    assert m.shots[0].serve_number == 1


@pytest.mark.parametrize(
    "change,message",
    [
        ({"type": "slice"}, "type must be one of"),
        ({"hitter": "left"}, "hitter must be one of"),
        ({"result": "maybe"}, "result must be one of"),
        ({"pointEnd": "ace"}, "pointEnd must be"),
        ({"time": -1}, "time must be"),
    ],
)
def test_bad_shots_say_where(change, message):
    raw = example()
    raw["shots"][1].update(change)
    with pytest.raises(LabelError, match="shot 2") as exc:
        parse_match(raw)
    assert message in str(exc.value)


def test_points_and_rally_length():
    points = split_points(parse_match(example()).shots)
    assert len(points) == 1
    # fault, then second serve + return + winner = rally of 3
    assert points[0].rally_length == 3
    assert points[0].ending == "winner"
    assert points[0].first_serve_in is False


# ─── Matching ────────────────────────────────────────────────────────────────

def test_closest_prediction_wins_the_match():
    label = parse_match(example()).shots
    raw = as_prediction(example(), s0003={"time": 25.45})
    # A decoy 0.2 s from s0003 sorts first by time but is farther than the real one.
    raw["shots"].append({"id": "decoy", "time": 25.10, "hitter": "far", "type": "volley", "result": "none"})
    pred = parse_match(raw).shots
    pairs = metrics.match_shots(label, pred, tolerance=0.25)
    matched_ids = {label[li].id: pred[pi].id for li, pi in pairs.items()}
    assert matched_ids == {"s0001": "s0001", "s0002": "s0002", "s0003": "s0003", "s0004": "s0004"}


def test_shots_outside_tolerance_are_misses():
    pred = as_prediction(example(), s0004={"time": 27.2})
    s = summary_for(example(), pred)
    assert s.stats["shot_detection_recall"].tally.correct == 3
    assert s.stats["shot_type"].tally.correct == 3   # missed shot counts as wrong


# ─── Stats ───────────────────────────────────────────────────────────────────

def test_perfect_predictions_meet_every_bar():
    s = summary_for(example(), as_prediction(example()))
    for stat in metrics.gated(s):
        assert stat.rate == 1.0, stat.name
        assert stat.meets_bar


def test_no_predictions_scores_zero_not_crash():
    s = summary_for(example(), None)
    assert s.stats["shot_type"].rate == 0.0
    assert s.stats["serve_placement"].rate == 0.0


def test_shot_type_mistake():
    s = summary_for(example(), as_prediction(example(), s0003={"type": "forehand"}))
    assert s.stats["shot_type"].tally.correct == 3
    assert s.confusion["shot_type"][("backhand", "forehand")] == 1


def test_close_call_counts_flagged_and_near_line():
    # s0004 is labeled a close call; s0003 lands 1.7 m from a line, so it isn't one.
    s = summary_for(example(), as_prediction(example(), s0004={"result": "out"}))
    cc = s.stats["close_call_in_out"].tally
    assert (cc.correct, cc.total) == (0, 1)
    assert s.stats["in_out"].tally.correct == s.stats["in_out"].tally.total - 1


def test_close_call_by_distance_without_flag():
    raw = example()
    raw["shots"][3]["closeCall"] = False      # still 3.5 cm inside the sideline
    s = summary_for(raw, as_prediction(raw))
    assert s.stats["close_call_in_out"].tally.total == 1


def test_net_prediction_counts_as_out():
    s = summary_for(example(), as_prediction(example(), s0001={"result": "net"}))
    assert s.stats["in_out"].rate == 1.0


def test_serve_placement_wrong_lane():
    s = summary_for(example(), as_prediction(example(), s0002={"bounce": {"time": 24.8, "court": [-0.4, 5.2]}}))
    sp = s.stats["serve_placement"].tally
    assert (sp.correct, sp.total) == (0, 1)
    assert s.confusion["serve_placement"][("deuce_body", "deuce_t")] == 1


def test_point_ending_and_errors():
    s = summary_for(example(), as_prediction(example(), s0004={"pointEnd": "unforced_error"}))
    assert s.stats["point_ending"].rate == 0.0
    assert s.errors["landing_error_m"]["median"] == 0.0


def test_in_progress_labels_are_skipped():
    raw = example()
    raw["status"] = "in_progress"
    s = summary_for(raw, as_prediction(raw))
    assert s.unscored_labels == ["example-public-hard-day"]
    assert s.stats["shot_type"].rate is None


# ─── Report ──────────────────────────────────────────────────────────────────

def test_report_shows_launch_decision():
    s = summary_for(example(), as_prediction(example(), s0003={"type": "forehand"}))
    md = report.to_markdown(s, {"version": "test-model"})
    assert "| Shot type | 75.0% |" in md
    assert "Hidden (below bar), only 4 examples" in md
    assert "| Serve placement (box and lane) | 100.0% |" in md


def test_wilson_interval_brackets_rate():
    t = metrics.Tally(correct=45, total=50)
    lo, hi = t.wilson()
    assert lo < 0.9 < hi


def test_regressions_only_flag_real_drops():
    base = {"stats": {"shot_type": {"rate": 0.92, "total": 200}}}
    assert report.regressions({"stats": {"shot_type": {"rate": 0.915, "total": 200}}}, base) == []
    assert report.regressions({"stats": {"shot_type": {"rate": 0.88, "total": 200}}}, base)
    # too few examples to call it a regression
    assert report.regressions({"stats": {"shot_type": {"rate": 0.5, "total": 5}}}, base) == []


# ─── CLI ─────────────────────────────────────────────────────────────────────

def test_cli_score_and_check(tmp_path):
    labels = tmp_path / "labels"
    preds = tmp_path / "preds"
    labels.mkdir()
    preds.mkdir()
    raw = example()
    (labels / "m.json").write_text(json.dumps(raw))
    (preds / "m.json").write_text(json.dumps(as_prediction(raw)))
    out = tmp_path / "out"
    assert main(["score", "--labels", str(labels), "--predictions", str(preds), "--out", str(out)]) == 0
    record = json.loads((out / "report.json").read_text())
    assert record["stats"]["shot_type"]["rate"] == 1.0

    # Make 30 copies so the regression check has enough examples, then break shot type.
    for i in range(30):
        r = copy.deepcopy(raw)
        r["matchId"] = f"m{i}"
        (labels / f"m{i}.json").write_text(json.dumps(r))
        (preds / f"m{i}.json").write_text(json.dumps(as_prediction(r)))
    main(["score", "--labels", str(labels), "--predictions", str(preds), "--out", str(out)])
    for i in range(30):
        bad = as_prediction(raw, s0003={"type": "volley"}, s0004={"type": "volley"})
        bad["matchId"] = f"m{i}"
        (preds / f"m{i}.json").write_text(json.dumps(bad))
    code = main(["score", "--labels", str(labels), "--predictions", str(preds),
                 "--baseline", str(out / "report.json"), "--check"])
    assert code == 2


def test_cli_validate_rejects_bad_file(tmp_path, capsys):
    (tmp_path / "bad.json").write_text("{not json")
    assert main(["validate", "--labels", str(tmp_path)]) == 1
    assert "not valid JSON" in capsys.readouterr().err
