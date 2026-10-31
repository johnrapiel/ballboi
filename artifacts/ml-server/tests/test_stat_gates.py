"""Stats below their eval bar are hidden; anything uncertain is hidden too."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from evaluation.gates import STATS, stat_gates  # noqa: E402

MODEL = {"version": "pipeline-abc", "degraded": False}


def _report(tmp_path, version="pipeline-abc", **rates):
    stats = {
        "shot_type": {"rate": 0.93, "bar": 0.90},
        "close_call_in_out": {"rate": 0.80, "bar": 0.85},
        "serve_placement": {"rate": None, "bar": 0.85},
        "point_ending": {"rate": 0.95, "bar": None},
    }
    for k, v in rates.items():
        stats[k]["rate"] = v
    path = tmp_path / "report.json"
    path.write_text(json.dumps({"model": {"version": version}, "scoredOn": "2026-11-20", "stats": stats}))
    return path


def shown(gates):
    return {k for k, v in gates["stats"].items() if v["shown"]}


def test_only_stats_at_or_above_their_bar_are_shown(tmp_path):
    gates = stat_gates(MODEL, _report(tmp_path))
    assert shown(gates) == {"shot_type"}
    assert gates["stats"]["line_calls"]["reason"] == "below bar"
    assert gates["stats"]["serve_placement"]["reason"] == "nothing scored yet"
    assert gates["stats"]["point_ending"]["reason"] == "no bar set"
    assert gates["stats"]["serve_speed"]["reason"] == "not measured by the eval yet"
    assert set(gates["stats"]) == set(STATS)


def test_exactly_at_the_bar_counts(tmp_path):
    assert "line_calls" in shown(stat_gates(MODEL, _report(tmp_path, close_call_in_out=0.85)))


def test_everything_hidden_without_a_matching_report(tmp_path):
    assert shown(stat_gates(MODEL, tmp_path / "missing.json")) == set()
    assert shown(stat_gates(MODEL, _report(tmp_path, version="pipeline-old"))) == set()
    assert shown(stat_gates({**MODEL, "degraded": True}, _report(tmp_path))) == set()
    assert shown(stat_gates(None, _report(tmp_path))) == set()


def test_shipped_result_today_hides_everything():
    """No labeled test set yet, so the server must hide every stat."""
    from evaluation.gates import REPORT
    if REPORT.exists():
        return
    assert shown(stat_gates(MODEL)) == set()
