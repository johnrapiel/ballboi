"""
Which stats the app may show (spec: "A stat that misses its bar is hidden at
launch, not shown with a disclaimer").

Every analysis result carries `statGates`, read from the committed eval report
(evaluation/reports/latest/report.json). A stat is shown only when:
- the report was made by exactly this pipeline and these model files,
- the models aren't stand-ins (degraded), and
- the stat has a bar in bars.json and its score meets it.

Anything else, including no report yet, hides the stat. The API strips hidden
stats from what it sends the app.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPORT = Path(__file__).resolve().parent / "reports" / "latest" / "report.json"

# App-facing stat -> the eval stat that decides it (bars in bars.json, spec
# decision 98). Estimated serve speed isn't a launch stat until there's a way to
# measure it, so it has no gate; the API hides any stat without one.
STATS: dict[str, str | None] = {
    "shot_type": "shot_type",
    "line_calls": "close_call_in_out",
    "serve_placement": "serve_placement",
    "point_ending": "point_ending",
    "placement_heatmap": "placement",
    "rally_length": "rally_length",
    "first_serve_pct": "first_serve_pct",
}


def _hidden(reason: str) -> dict[str, Any]:
    return {"shown": False, "reason": reason}


def stat_gates(model: dict[str, Any] | None, report_path: Path = REPORT) -> dict[str, Any]:
    model = model or {}
    try:
        report = json.loads(report_path.read_text())
    except (OSError, ValueError):
        report = None

    def gate(eval_name: str | None) -> dict[str, Any]:
        if eval_name is None:
            return _hidden("not measured by the eval yet")
        if model.get("degraded"):
            return _hidden("stand-in models")
        if report is None:
            return _hidden("no eval report yet")
        if report.get("model", {}).get("version") != model.get("version"):
            return _hidden("eval report is from a different pipeline")
        stat = report.get("stats", {}).get(eval_name) or {}
        rate, bar = stat.get("rate"), stat.get("bar")
        if bar is None:
            return _hidden("no bar set")
        if rate is None:
            return _hidden("nothing scored yet")
        if rate < bar:
            return {"shown": False, "reason": "below bar", "rate": rate, "bar": bar}
        return {"shown": True, "rate": rate, "bar": bar}

    return {
        "evalVersion": (report or {}).get("model", {}).get("version"),
        "scoredOn": (report or {}).get("scoredOn"),
        "stats": {name: gate(eval_name) for name, eval_name in STATS.items()},
    }
