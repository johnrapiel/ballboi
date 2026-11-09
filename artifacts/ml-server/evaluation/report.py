"""Turns an eval summary into a readable Markdown report and a JSON record."""
from __future__ import annotations

import datetime as dt
from typing import Any

from evaluation.metrics import StatResult, Summary

# Below this many examples a score can swing by 10+ points, so the report says so.
MIN_TRUSTED_EXAMPLES = 50

STAT_NAMES = {
    "shot_type": "Shot type",
    "close_call_in_out": "In or out, close calls",
    "serve_placement": "Serve placement (box and lane)",
    "shot_detection_recall": "Shots found (of labeled shots)",
    "shot_detection_precision": "Shots found that were real",
    "hitter": "Right player credited",
    "in_out": "In or out, all shots",
    "point_ending": "Point ending (winner, forced, unforced)",
    "rally_length": "Rally length (within 1 shot)",
    "first_serve_pct": "First serve % (within 5 points, per match)",
    "placement": "Placement (right landing zone)",
    "close_call_flagged": "Close calls labeled \"Close call\"",
    "wrong_calls_flagged": "Wrong calls that were labeled \"Close call\"",
}

# The seven stats the app gates at launch, in the order the report lists them.
LAUNCH_STATS = ("shot_type", "close_call_in_out", "serve_placement", "point_ending",
                "rally_length", "first_serve_pct", "placement")

ERROR_NAMES = {
    "landing_error_m": ("Landing spot error", "m"),
    "contact_time_error_s": ("Contact time error", "s"),
    "rally_length_abs_error": ("Rally length error", "shots"),
    "first_serve_pct_error": ("First serve % error per match", "pts"),
}


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _range(stat: StatResult) -> str:
    ci = stat.tally.wilson()
    return "n/a" if ci is None else f"{ci[0] * 100:.0f} to {ci[1] * 100:.0f}%"


def launch_status(stat: StatResult) -> str:
    if stat.bar is None:
        return "Hidden (no bar set)"
    if stat.rate is None:
        return "Hidden (nothing to score yet)"
    status = "Shown" if stat.meets_bar else "Hidden (below bar)"
    if stat.tally.total < MIN_TRUSTED_EXAMPLES:
        n = stat.tally.total
        status += f", only {n} example{'' if n == 1 else 's'}"
    return status


def to_markdown(summary: Summary, model: dict[str, Any], regressions: list[str] | None = None) -> str:
    total_shots = sum(m.tallies.get("shot_detection_recall").total
                      for m in summary.matches if m.tallies.get("shot_detection_recall"))
    lines = [
        f"# Ball Boi eval: {model.get('version', 'unknown model')}",
        "",
        f"Scored {dt.date.today().isoformat()} on {len(summary.matches)} labeled matches "
        f"({total_shots} labeled shots).",
        "",
    ]
    if regressions is not None:
        if regressions:
            lines += ["**Worse than the baseline:**", ""] + [f"- {r}" for r in regressions] + [""]
        else:
            lines += ["No stat got worse than the baseline.", ""]

    lines += ["## Launch decision", "", "| Stat | Score | Likely range | Bar | At launch |", "|---|---|---|---|---|"]
    for name in LAUNCH_STATS:
        stat = summary.stats.get(name)
        if stat is None:
            continue
        bar = "none" if stat.bar is None else f"{stat.bar * 100:.0f}%"
        lines.append(f"| {STAT_NAMES.get(stat.name, stat.name)} | {_pct(stat.rate)} | {_range(stat)} "
                     f"| {bar} | {launch_status(stat)} |")
    lines.append("")
    lines.append("Estimated serve speed isn't a launch stat until there's a way to measure it (decision 98).")
    lines.append("")

    lines += ["## Other numbers", "", "| Measure | Score | Examples |", "|---|---|---|"]
    for name in ("shot_detection_recall", "shot_detection_precision", "hitter", "in_out",
                 "close_call_flagged", "wrong_calls_flagged"):
        stat = summary.stats.get(name)
        if stat:
            lines.append(f"| {STAT_NAMES[name]} | {_pct(stat.rate)} | {stat.tally.total} |")
    for name, (label, unit) in ERROR_NAMES.items():
        e = summary.errors.get(name)
        if e:
            lines.append(f"| {label} (median, 90th percentile) | {e['median']:.2f} {unit}, {e['p90']:.2f} {unit} "
                         f"| {int(e['count'])} |")
    lines.append("")

    lines += ["## By condition", ""]
    any_condition = False
    for stat in (s for s in summary.stats.values() if s.bar is not None):
        for key, groups in sorted(stat.by_condition.items()):
            any_condition = True
            parts = ", ".join(f"{value} {_pct(t.rate)} ({t.total})" for value, t in sorted(groups.items()))
            lines.append(f"- {STAT_NAMES[stat.name]} by {key}: {parts}")
    if not any_condition:
        lines.append("No conditions recorded on the labeled matches yet.")
    lines.append("")

    lines += ["## Most common mistakes", ""]
    for name in ("shot_type", "close_call_in_out", "serve_placement", "point_ending", "placement"):
        table = summary.confusion.get(name, {})
        mistakes = sorted(((n, t, p) for (t, p), n in table.items() if t != p), reverse=True)[:5]
        if mistakes:
            parts = "; ".join(f"{t} called {p} ({n})" for n, t, p in mistakes)
            lines.append(f"- {STAT_NAMES[name]}: {parts}")
    lines.append("")

    per_match = ("shot_type", "close_call_in_out", "serve_placement", "point_ending", "rally_length",
                 "first_serve_pct", "placement", "shot_detection_recall")
    lines += ["## Per match", "",
              "| Match | Shot type | Close calls | Serve placement | Point ending | Rally length "
              "| First serve % | Placement | Shots found |",
              "|---|---|---|---|---|---|---|---|---|"]
    for m in summary.matches:
        cells = [_pct(m.tallies[n].rate) if n in m.tallies else "n/a" for n in per_match]
        lines.append(f"| {m.match_id} | " + " | ".join(cells) + " |")
    lines.append("")

    total = sum(summary.label_sources.values())
    accepted = summary.label_sources.get("model", 0)
    if total and (accepted or summary.label_sources.get("model-edited")):
        edited = summary.label_sources.get("model-edited", 0)
        lines.append(f"Labels from analysis suggestions: {accepted} of {total} accepted unchanged "
                     f"({accepted / total:.0%}), {edited} corrected. A high unchanged share can flatter the "
                     "scores; spot-check a few.")
        lines.append("")
    if summary.unscored_labels:
        lines.append("Not scored, labeling still in progress: " + ", ".join(summary.unscored_labels) + ".")
    if summary.unlabeled_predictions:
        lines.append("Predictions with no labels: " + ", ".join(summary.unlabeled_predictions) + ".")
    return "\n".join(lines).rstrip() + "\n"


def to_record(summary: Summary, model: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "scoredOn": dt.date.today().isoformat(),
        "matches": [m.match_id for m in summary.matches],
        "stats": {
            name: {
                "rate": stat.rate,
                "correct": stat.tally.correct,
                "total": stat.tally.total,
                "bar": stat.bar,
                "atLaunch": launch_status(stat),
            }
            for name, stat in summary.stats.items()
        },
        "errors": summary.errors,
    }


def regressions(current: dict[str, Any], baseline: dict[str, Any],
                allowed_drop: float = 0.01, min_examples: int = 20) -> list[str]:
    """Stats that got worse than the baseline by more than `allowed_drop`."""
    out = []
    for name, now in current.get("stats", {}).items():
        before = baseline.get("stats", {}).get(name)
        if not before or now.get("rate") is None or before.get("rate") is None:
            continue
        if now["total"] < min_examples or before["total"] < min_examples:
            continue
        if now["rate"] < before["rate"] - allowed_drop:
            out.append(f"{STAT_NAMES.get(name, name)}: {_pct(before['rate'])} to {_pct(now['rate'])}")
    return out
