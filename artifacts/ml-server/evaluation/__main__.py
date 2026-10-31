"""
Ball Boi eval harness.

  python -m evaluation run --videos <folder>          # analyze every labeled match, then score
  python -m evaluation score --predictions <folder>   # score saved predictions
  python -m evaluation validate                       # check every label file

Options:
  --labels <folder>     labeled matches (default: evaluation/labels)
  --bars <file>         launch bars (default: evaluation/bars.json)
  --baseline <file>     JSON from an earlier run; flags any stat that got worse
  --out <folder>        where to write report.md and report.json
  --check               exit 2 if a stat got worse than the baseline
  --include-in-progress score label files still marked in_progress

run only:
  --videos <folder>     where the match videos are (file name from each label)
  --from-r2             download videos missing locally from R2 (label's r2Key, S3_* settings)
  --court phone|detect  phone (default): use the labeled court corners, as the phone
                        sends them; detect: the pipeline finds the court itself
  --allow-fallback      run without model files (motion ball detector, no pose)

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


def run(args: argparse.Namespace) -> int:
    """Analyzes each finished label's video with the current pipeline, caches predictions, scores."""
    from services.pipeline.models import ModelsMissing, load_models
    from services.pipeline.run import AnalysisError, analyze_match, to_prediction_file

    try:
        labels = load_dir(args.labels)
    except LabelError as exc:
        print(f"Can't read a label file: {exc}", file=sys.stderr)
        return 1
    try:
        models = load_models(allow_fallback=args.allow_fallback)
    except ModelsMissing as exc:
        print(f"{exc}\nBuild them with the Docker image (see README), or pass --allow-fallback.", file=sys.stderr)
        return 1
    version = models.describe()["version"] + ("-detect" if args.court == "detect" else "")
    pred_dir = HERE.parent / "predictions" / version
    pred_dir.mkdir(parents=True, exist_ok=True)

    for match_id, label in sorted(labels.items()):
        if label.status != "done" and not args.include_in_progress:
            continue
        out = pred_dir / f"{match_id}.json"
        if out.exists():
            print(f"{match_id}: cached")
            continue
        video = _find_video(label, args)
        if video is None:
            print(f"{match_id}: no video found, skipped", file=sys.stderr)
            continue
        raw = json.loads(label.path.read_text())
        corners = (raw.get("calibrations") or [{}])[0].get("corners") if args.court == "phone" else None
        print(f"{match_id}: analyzing {video.name} ...", flush=True)
        try:
            result = analyze_match(str(video), calibration=corners, models=models)
            pred = to_prediction_file(result, match_id)
            pred["model"]["court"] = args.court
        except AnalysisError as exc:
            print(f"{match_id}: {exc}", file=sys.stderr)
            pred = {"schemaVersion": 1, "matchId": match_id, "model": {"version": version, "error": str(exc)}, "shots": []}
        out.write_text(json.dumps(pred) + "\n")
        print(f"{match_id}: {len(pred['shots'])} shots ({result['processingTimeMs'] // 1000 if pred['shots'] else 0}s)")

    args.predictions = pred_dir
    return score(args)


def _find_video(label, args) -> Path | None:
    name = label.video.get("file") or f"{label.match_id}.mp4"
    local = Path(args.videos).expanduser() / name if args.videos else None
    if local and local.is_file():
        return local
    if args.from_r2 and label.video.get("r2Key"):
        from services.storage import download

        cache = HERE.parent / ".cache" / "videos"
        cache.mkdir(parents=True, exist_ok=True)
        target = cache / name
        if not target.is_file():
            print(f"{label.match_id}: downloading from R2 ...", flush=True)
            tmp = download(label.video["r2Key"], dest_dir=str(cache))
            Path(tmp).rename(target)
        return target
    return None


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

    p_run = sub.add_parser("run", parents=[common], help="analyze every labeled match, then score")
    p_run.add_argument("--videos", type=Path)
    p_run.add_argument("--from-r2", action="store_true")
    p_run.add_argument("--court", choices=("phone", "detect"), default="phone")
    p_run.add_argument("--allow-fallback", action="store_true")
    p_run.add_argument("--bars", type=Path, default=DEFAULT_BARS)
    p_run.add_argument("--baseline", type=Path)
    p_run.add_argument("--out", type=Path, default=HERE / "reports" / "latest")
    p_run.add_argument("--check", action="store_true")
    p_run.add_argument("--include-in-progress", action="store_true")
    p_run.add_argument("--tolerance", type=float, default=metrics.DEFAULT_TIME_TOLERANCE)
    p_run.add_argument("--close-call-meters", type=float, default=metrics.DEFAULT_CLOSE_CALL_METERS)
    p_run.set_defaults(func=run)

    p_val = sub.add_parser("validate", parents=[common], help="check every label file")
    p_val.set_defaults(func=validate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
