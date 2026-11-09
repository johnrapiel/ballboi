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
BARS = json.loads((EXAMPLE.parent.parent / "bars.json").read_text())
BARS = {k: v for k, v in BARS.items() if not k.startswith("_")}


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


def test_bars_match_decision_98():
    assert BARS == {"shot_type": 0.90, "close_call_in_out": 0.85, "serve_placement": 0.85,
                    "point_ending": 0.85, "rally_length": 0.85, "first_serve_pct": 0.85, "placement": 0.80}


def _extra_shots(raw, times):
    """Inserts rally shots (no bounce) into the example's point before its last shot."""
    for i, t in enumerate(times):
        raw["shots"].insert(3, {"id": f"x{i}", "time": t, "hitter": "near", "type": "forehand",
                                "serveNumber": None, "bounce": None, "result": "none",
                                "closeCall": False, "pointEnd": None})
    return raw


def test_rally_length_within_one_shot_counts():
    # The example point is 3 shots long (the fault doesn't count).
    s = summary_for(example(), as_prediction(_extra_shots(example(), [26.2])))
    assert s.stats["rally_length"].rate == 1.0
    s = summary_for(example(), as_prediction(_extra_shots(example(), [26.0, 26.3])))
    assert s.stats["rally_length"].rate == 0.0
    assert s.errors["rally_length_abs_error"]["median"] == 2


def test_rally_length_missed_point_counts_as_wrong():
    s = summary_for(example(), as_prediction(example(), s0004={"pointEnd": None}))
    t = s.stats["rally_length"].tally
    assert (t.correct, t.total) == (0, 1)
    assert summary_for(example(), None).stats["rally_length"].rate == 0.0


def test_first_serve_pct_within_five_points_per_match():
    assert summary_for(example(), as_prediction(example())).stats["first_serve_pct"].rate == 1.0
    # The first serve was out (0%); predicting it in says 100%.
    s = summary_for(example(), as_prediction(example(), s0001={"result": "in"}))
    t = s.stats["first_serve_pct"].tally
    assert (t.correct, t.total) == (0, 1)
    assert s.errors["first_serve_pct_error"]["median"] == 100
    assert summary_for(example(), None).stats["first_serve_pct"].rate == 0.0


def _shot(x, y, result="in"):
    from evaluation.schema import parse_shot
    return parse_shot({"id": "z", "time": 1.0, "hitter": "near", "type": "forehand", "serveNumber": None,
                       "bounce": {"time": 1.5, "court": [x, y]}, "result": result,
                       "closeCall": False, "pointEnd": None}, "test")


def test_placement_zones():
    assert metrics.placement_zone(_shot(0.0, 3.0)) == "far_short_middle"
    assert metrics.placement_zone(_shot(-3.5, 10.0)) == "far_deep_left"
    assert metrics.placement_zone(_shot(3.5, -8.0)) == "near_deep_right"
    assert metrics.placement_zone(_shot(3.5, -8.0, result="out")) is None


def test_placement_wrong_zone_and_misses():
    s = summary_for(example(), as_prediction(example()))
    t = s.stats["placement"].tally
    assert (t.correct, t.total) == (3, 3)          # every in-bounce in the example
    s = summary_for(example(), as_prediction(example(), s0003={"bounce": {"time": 26.1, "court": [2.4, -9.8]}}))
    assert s.stats["placement"].tally.correct == 2
    assert s.confusion["placement"][("near_deep_left", "near_deep_right")] == 1
    assert summary_for(example(), None).stats["placement"].rate == 0.0


# ─── Report ──────────────────────────────────────────────────────────────────

def test_report_shows_launch_decision():
    s = summary_for(example(), as_prediction(example(), s0003={"type": "forehand"}))
    md = report.to_markdown(s, {"version": "test-model"})
    assert "| Shot type | 75.0% |" in md
    assert "Hidden (below bar), only 4 examples" in md
    assert "| Serve placement (box and lane) | 100.0% |" in md


def test_report_lists_all_seven_launch_stats_and_no_serve_speed():
    md = report.to_markdown(summary_for(example(), as_prediction(example())), {"version": "test-model"})
    launch = md.split("## Launch decision")[1].split("##")[0]
    rows = [line for line in launch.splitlines() if line.startswith("| ") and not line.startswith("| Stat")]
    assert len(rows) == 7
    for name in ("Point ending", "Rally length", "First serve %", "Placement (right landing zone)"):
        assert any(name in r and "| Shown" in r for r in rows), name
    assert "| 80% |" in launch
    assert "Serve speed" not in md and "serve speed isn't a launch stat" in md


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


def test_report_counts_labels_from_suggestions():
    raw = example()
    raw["shots"][0]["source"] = "model"
    raw["shots"][1]["source"] = "model-edited"
    s = summary_for(raw, as_prediction(raw))
    assert s.label_sources == {"model": 1, "model-edited": 1, "human": 2}
    assert "1 of 4 accepted unchanged" in report.to_markdown(s, {"version": "x"})
