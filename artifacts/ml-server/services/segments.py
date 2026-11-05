"""
Joins the pieces of one match into a single video before analysis.

A call that rings mid-match and isn't answered stops the phone's recording
for the seconds it rings; Ball Boi then carries on in a new piece of the same
match (Wave 1 review, John's decision Q3). The pieces come from the same
camera with the same settings (720p, 30 fps, H.264), so they join without
re-encoding: ffmpeg's concat demuxer copies the streams as they are. The
match then gets one analysis and one replay; only the ringing seconds are
missing.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile


class SegmentsError(RuntimeError):
    pass


def concat_list(paths: list[str]) -> str:
    """The concat demuxer's list file: one quoted path per line."""
    lines = []
    for p in paths:
        escaped = os.path.abspath(p).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    return "\n".join(lines) + "\n"


def join_segments(paths: list[str], dst: str, run=subprocess.run) -> str:
    """Writes the pieces, in order, into one video at dst and returns dst."""
    if not paths:
        raise SegmentsError("No video to analyze.")
    if len(paths) == 1:
        shutil.copyfile(paths[0], dst)
        return dst
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SegmentsError("ffmpeg isn't installed, so the pieces of this match can't be joined.")
    fd, list_path = tempfile.mkstemp(suffix=".txt")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(concat_list(paths))
        run(
            [ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-map", "0", "-c", "copy", "-movflags", "+faststart", dst],
            check=True, capture_output=True, timeout=3600,
        )
    finally:
        os.unlink(list_path)
    return dst
