"""
Footage review for the test set.

    python -m intake check <video>                      # review one file
    python -m intake scan <folder> --out <folder>       # review every new video in a folder

`scan` remembers what it has reviewed (by name, size, and modified time), so it
can run every hour and only looks at new uploads. It writes:
  Review.md        every video's verdict, newest first, with a drafted note to the friend
  review.json      the same, for tools
  new.txt          one line per video reviewed in this run (used for the notification)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from intake.check import Review, friend_message, review  # noqa: E402

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v"}
SETTLE_SECONDS = 120     # skip files modified this recently: they may still be syncing


def _ball_detector(allow_missing: bool = True):
    from services.pipeline.models import ModelsMissing, load_models

    try:
        return load_models(allow_fallback=allow_missing).ball
    except ModelsMissing:
        return None


def _summary_line(r: Review) -> str:
    reasons = "; ".join(f.message.rstrip(".") for f in r.findings if f.level != "ok")
    return f"{r.file}: {r.verdict}" + (f" ({reasons})" if reasons else "")


def _markdown(entries: list[dict]) -> str:
    lines = ["# Ball Boi footage review", "",
             "Newest first. Verdicts: Good, Usable with notes, Needs a re-record.", ""]
    for e in entries:
        r = e["review"]
        lines.append(f"## {r['file']}: {r['verdict']}")
        lines.append(f"Reviewed {e['reviewedAt']}")
        facts = r.get("facts", {})
        if facts.get("size"):
            w, h = facts["size"]
            mins = facts.get("duration", 0) / 60
            lines.append(f"{w}x{h}, {facts.get('fps', 0):g} fps, {mins:.0f} min, {facts.get('bitrateMbps', 0):g} Mbps"
                         + (f", {facts['hdr']}" if facts.get("hdr") else ""))
        lines.append("")
        for f in r["findings"]:
            if f["level"] != "ok":
                lines.append(f"- {'Fix' if f['level'] == 'fix' else 'Note'}: {f['message']}")
        if e.get("message"):
            lines += ["", "Draft to send:", "", "> " + e["message"].replace("\n", "\n> ")]
        lines.append("")
    return "\n".join(lines)


def scan(folder: Path, out: Path, allow_missing_models: bool = True) -> int:
    out.mkdir(parents=True, exist_ok=True)
    state_path = out / "review.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"entries": []}
    seen = {(e["file"], e["bytes"], e["mtime"]) for e in state["entries"]}

    now = dt.datetime.now().timestamp()
    todo = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in VIDEO_SUFFIXES or p.name.startswith("."):
            continue
        st = p.stat()
        key = (p.name, st.st_size, int(st.st_mtime))
        if key in seen or now - st.st_mtime < SETTLE_SECONDS:
            continue
        todo.append((p, key))

    new_lines = []
    detector = _ball_detector(allow_missing_models) if todo else None
    for p, (name, size, mtime) in todo:
        print(f"Reviewing {name} ...", flush=True)
        r = review(p, detector)
        msg = friend_message(r)
        entry = {"file": name, "bytes": size, "mtime": mtime,
                 "reviewedAt": dt.datetime.now().strftime("%b %-d, %-I:%M %p"),
                 "review": r.to_dict(), "message": msg}
        # A re-uploaded file replaces its old entry.
        state["entries"] = [e for e in state["entries"] if e["file"] != name]
        state["entries"].insert(0, entry)
        new_lines.append(_summary_line(r))
        print("  " + _summary_line(r), flush=True)
        tmp = state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        os.replace(tmp, state_path)
        (out / "Review.md").write_text(_markdown(state["entries"]))

    (out / "new.txt").write_text("\n".join(new_lines) + ("\n" if new_lines else ""))
    if not todo:
        print("No new videos.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m intake")
    sub = parser.add_subparsers(dest="command", required=True)
    p_check = sub.add_parser("check", help="review one video")
    p_check.add_argument("video", type=Path)
    p_check.add_argument("--json", action="store_true")
    p_scan = sub.add_parser("scan", help="review every new video in a folder")
    p_scan.add_argument("folder", type=Path)
    p_scan.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.command == "check":
        r = review(args.video, _ball_detector())
        if args.json:
            print(json.dumps(r.to_dict(), indent=2))
        else:
            print(_summary_line(r))
            msg = friend_message(r)
            if msg:
                print("\nDraft to send:\n" + msg)
        return 0 if r.level != "fix" else 2
    if not args.folder.is_dir():
        print(f"Can't find the folder: {args.folder}", file=sys.stderr)
        return 1
    return scan(args.folder, args.out)


if __name__ == "__main__":
    sys.exit(main())
