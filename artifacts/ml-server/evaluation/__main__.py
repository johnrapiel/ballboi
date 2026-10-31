"""
Ball Boi eval harness.

  python -m evaluation score --predictions <folder>   # score saved predictions
  python -m evaluation validate                       # check every label file

Options:
  --labels <folder>     labeled matches (default: evaluation/labels)
  --bars <file>         launch bars (default: evaluation/bars.json)
  --baseline <file>     JSON from an earlier run; flags any stat that got worse
  --out <folder>        where to write report.md and report.json
  --check               exit 2 if a stat got worse than the baseline
  --include-in-progress score label files still marked in_progress

Exit codes: 0 ok, 1 bad input, 2 a stat got worse than the baseline.
A stat under its launch bar doesn't fail the run: per the spec it's hidden at
launch, and the report says so.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from evaluation import metrics, report  # noqa: E402
from evaluation.schema import LabelError, load_dir  # noqa: E402

DEFAULT_LABELS = HERE / "labels"
DEFAULT_BARS = HERE / "bars.json"


def load_bars(path: Path) -> dict[str, float]:
    raw = json.loads(path.read_text())
    return {k: float(v) for k, v in raw.items() if not k.startswith("_")}


def score(args: argparse.Namespace) -> int:
    try:
        labels = load_dir(args.labels)
        predictions = load_dir(args.predictions)
    except LabelError as exc:
        print(f"Can't read a file: {exc}", file=sys.stderr)
        return 1
    if not labels:
        print(f"No label files in {args.labels}", file=sys.stderr)
        return 1

    include = (lambda m: True) if args.include_in_progress else (lambda m: m.status == "done")
    summary = metrics.summarize(labels, predictions, load_bars(args.bars),
                                tolerance=args.tolerance, close_call_meters=args.close_call_meters,
                                include=include)
    model = next((p.model for p in predictions.values() if p.model), {})
    record = report.to_record(summary, model)

    found = None
    if args.baseline:
        baseline = json.loads(Path(args.baseline).read_text())
        found = report.regressions(record, baseline)
    markdown = report.to_markdown(summary, model, found)

    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.md").write_text(markdown)
        (out / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(markdown)
    if args.check and found:
        return 2
    return 0


def validate(args: argparse.Namespace) -> int:
    try:
        labels = load_dir(args.labels)
    except LabelError as exc:
        print(f"Problem: {exc}", file=sys.stderr)
        return 1
    for match_id, m in labels.items():
        serves = sum(1 for s in m.shots if s.is_serve)
        ends = sum(1 for s in m.shots if s.point_end)
        print(f"{match_id}: {len(m.shots)} shots, {serves} serves, {ends} points, {m.status}")
    print(f"{len(labels)} label files OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evaluation", description="Ball Boi eval harness")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--labels", type=Path, default=DEFAULT_LABELS)

    p_score = sub.add_parser("score", parents=[common], help="score saved predictions")
    p_score.add_argument("--predictions", type=Path, required=True)
    p_score.add_argument("--bars", type=Path, default=DEFAULT_BARS)
    p_score.add_argument("--baseline", type=Path)
    p_score.add_argument("--out", type=Path)
    p_score.add_argument("--check", action="store_true")
    p_score.add_argument("--include-in-progress", action="store_true")
    p_score.add_argument("--tolerance", type=float, default=metrics.DEFAULT_TIME_TOLERANCE)
    p_score.add_argument("--close-call-meters", type=float, default=metrics.DEFAULT_CLOSE_CALL_METERS)
    p_score.set_defaults(func=score)

    p_val = sub.add_parser("validate", parents=[common], help="check every label file")
    p_val.set_defaults(func=validate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
