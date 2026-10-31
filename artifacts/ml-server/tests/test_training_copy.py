"""The training copy: video only, audio gone, and never a reason for analysis to fail."""
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import storage  # noqa: E402
from services import training_copy as tc  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                  reason="ffmpeg isn't installed")


def _streams(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return [s["codec_type"] for s in json.loads(out)["streams"]]


@pytest.fixture
def match_with_audio(tmp_path):
    path = str(tmp_path / "match.mp4")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "mpeg4", "-c:a", "aac",
                    "-shortest", path], check=True)
    assert sorted(_streams(path)) == ["audio", "video"]
    return path


@needs_ffmpeg
def test_copy_has_video_and_no_audio(match_with_audio, tmp_path):
    out = str(tmp_path / "copy.mp4")
    tc.video_only_copy(match_with_audio, out)
    assert _streams(out) == ["video"]


@needs_ffmpeg
def test_training_copy_uploads_under_training(match_with_audio):
    seen = {}

    def fake_upload(local, key):
        seen["streams"] = _streams(local)
        seen["key"] = key
        return key
    assert tc.make_training_copy(match_with_audio, 42, upload=fake_upload) == "/objects/training/session-42.mp4"
    assert seen["streams"] == ["video"]


def test_failures_mean_no_copy(tmp_path):
    def broken_upload(local, key):
        raise OSError("bucket missing")
    bad = tmp_path / "not-a-video.mp4"
    bad.write_bytes(b"nope")
    assert tc.make_training_copy(str(bad), 1, upload=broken_upload) is None
    assert not [p for p in os.listdir(tmp_path) if p != "not-a-video.mp4"]


def test_upload_streams_a_presigned_put(tmp_path):
    got = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_PUT(self):
            got["path"] = self.path
            got["body"] = self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass
    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        cfg = storage.S3Config("ballboi", "AKID", "secret", "auto", f"http://127.0.0.1:{server.server_port}")
        f = tmp_path / "v.mp4"
        f.write_bytes(b"video bytes")
        assert storage.upload(str(f), "/objects/training/session-3.mp4", cfg) == "/objects/training/session-3.mp4"
    finally:
        server.shutdown()
    assert got["path"].startswith("/ballboi/training/session-3.mp4?") and "X-Amz-Signature=" in got["path"]
    assert got["body"] == b"video bytes"
