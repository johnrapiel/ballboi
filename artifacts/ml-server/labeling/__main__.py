"""
Start the labeling tool on this computer only (127.0.0.1).

    python -m labeling --videos ~/BallBoiTestSet
    python -m labeling --beta        beta recordings from ~/BallBoiTestSet/Beta
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from labeling.app import create_app  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m labeling", description="Ball Boi labeling tool")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--videos", type=Path, help="folder with the test-set match videos")
    source.add_argument("--beta", action="store_true",
                        help="use the beta recordings downloaded by scripts/mac/download-beta.sh "
                             "(~/BallBoiTestSet/Beta, or BALLBOI_BETA_FOLDER)")
    parser.add_argument("--labels", type=Path, default=HERE.parent / "evaluation" / "labels",
                        help="where label files are saved (default: evaluation/labels)")
    parser.add_argument("--analysis", type=Path, default=None,
                        help="where analysis results are saved (default: next to the labels folder)")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--host", default="127.0.0.1",
                        help="127.0.0.1 keeps it on this computer; inside Docker use 0.0.0.0 and publish to 127.0.0.1")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.beta:
        args.videos = Path(os.environ.get("BALLBOI_BETA_FOLDER") or Path.home() / "BallBoiTestSet" / "Beta")
        if not args.videos.expanduser().is_dir():
            sys.exit(f"No beta recordings yet in {args.videos}. Double-click Download beta recordings first.")
    if not args.videos.expanduser().is_dir():
        sys.exit(f"Can't find the videos folder: {args.videos}")

    import uvicorn

    url = f"http://127.0.0.1:{args.port}"
    print(f"Labeling tool: {url}  (Ctrl + C to stop)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(args.videos, args.labels, args.analysis), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
