"""Pieces of one match join into one video, in order, without re-encoding."""
import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import segments  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                  reason="ffmpeg isn't installed")


def _duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


def _clip(path, seconds):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=30:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:v", "libx264", "-c:a", "aac",
                    "-shortest", path], check=True)
    return path


def test_concat_list_quotes_every_path_in_order(tmp_path):
    a, b = str(tmp_path / "a.mov"), str(tmp_path / "it's b.mov")
    text = segments.concat_list([a, b])
    assert text.splitlines() == [f"file '{a}'", "file '" + b.replace("'", "'\\''") + "'"]


def test_one_piece_is_copied_as_is(tmp_path):
    src = tmp_path / "only.mov"
    src.write_bytes(b"video")
    out = segments.join_segments([str(src)], str(tmp_path / "out.mov"), run=lambda *a, **k: pytest.fail("no ffmpeg needed"))
    assert open(out, "rb").read() == b"video"


def test_no_pieces_is_an_analysis_error(tmp_path):
    with pytest.raises(segments.SegmentsError):
        segments.join_segments([], str(tmp_path / "out.mov"))


def test_pieces_go_to_ffmpeg_concat_with_stream_copy(tmp_path, monkeypatch):
    monkeypatch.setattr(segments.shutil, "which", lambda _: "/usr/bin/ffmpeg")
    seen = {}

    def fake_run(args, **kwargs):
        seen["args"] = args
        seen["list"] = open(args[args.index("-i") + 1]).read()

    segments.join_segments(["/v/1.mov", "/v/2.mov"], "/v/out.mov", run=fake_run)
    assert seen["args"][:1] == ["/usr/bin/ffmpeg"]
    assert ["-f", "concat"] == seen["args"][seen["args"].index("-f"):seen["args"].index("-f") + 2]
    assert "-c" in seen["args"] and seen["args"][seen["args"].index("-c") + 1] == "copy"
    assert seen["list"] == "file '/v/1.mov'\nfile '/v/2.mov'\n"


@needs_ffmpeg
def test_two_real_pieces_make_one_video_as_long_as_both(tmp_path):
    a = _clip(str(tmp_path / "a.mov"), 1)
    b = _clip(str(tmp_path / "b.mov"), 2)
    out = segments.join_segments([a, b], str(tmp_path / "joined.mov"))
    assert abs(_duration(out) - 3.0) < 0.3
