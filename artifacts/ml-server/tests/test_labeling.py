"""Labeling tool server: lists videos, serves them, and saves labels the eval can read."""
import json
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import socket  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import uvicorn  # noqa: E402

from evaluation.schema import load_match  # noqa: E402
from labeling.app import calibration_at, create_app, fill_court_positions  # noqa: E402
from services import court_model  # noqa: E402

CORNERS = [[0.18, 0.92], [0.82, 0.92], [0.63, 0.31], [0.37, 0.31]]


def make_video(path, frames=15, size=(160, 90), fps=30.0):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(frames):
        writer.write(np.full((size[1], size[0], 3), i * 10 % 255, dtype=np.uint8))
    writer.release()


class Response:
    def __init__(self, status_code, content):
        self.status_code = status_code
        self.content = content
        self.text = content.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.content)


class Client:
    """Tiny HTTP client against a real local server (no extra test dependencies)."""

    def __init__(self, base):
        self.base = base

    def _send(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return Response(res.status, res.read())
        except urllib.error.HTTPError as err:
            return Response(err.code, err.read())

    def get(self, path, headers=None):
        return self._send("GET", path, headers=headers)

    def put(self, path, json=None):
        return self._send("PUT", path, body=json)


def serve(app):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    return server, thread, f"http://127.0.0.1:{port}"


@pytest.fixture
def client(tmp_path):
    videos = tmp_path / "videos"
    labels = tmp_path / "labels"
    videos.mkdir()
    make_video(videos / "match-one.mp4")
    (videos / "notes.txt").write_text("not a video")
    server, thread, base = serve(create_app(videos, labels))
    yield Client(base), labels
    server.should_exit = True
    thread.join(timeout=5)


def test_page_and_court_load(client):
    c, _ = client
    assert "Ball Boi Labeling" in c.get("/").text
    court = c.get("/api/court").json()
    assert court["order"][0] == "near-left"
    assert len(court["lines"]) == len(court_model.COURT_LINES_M)


def test_lists_only_videos(client):
    c, _ = client
    vids = c.get("/api/videos").json()["videos"]
    assert [v["matchId"] for v in vids] == ["match-one"]
    assert vids[0]["status"] == "not_started"


def test_new_label_has_video_metadata(client):
    c, _ = client
    label = c.get("/api/labels/match-one").json()
    assert label["matchId"] == "match-one"
    assert label["video"]["fps"] == pytest.approx(30.0, rel=0.01)
    assert label["video"]["width"] == 160
    assert label["shots"] == []


def test_video_supports_range_requests(client):
    c, _ = client
    res = c.get("/video/match-one", headers={"Range": "bytes=0-99"})
    assert res.status_code == 206
    assert len(res.content) == 100


def test_unknown_and_unsafe_ids_are_rejected(client):
    c, _ = client
    assert c.get("/api/labels/nope").status_code == 404
    assert c.get("/video/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert c.get("/api/labels/.hidden").status_code == 404


def test_save_fills_court_positions_and_round_trips(client):
    c, labels = client
    label = c.get("/api/labels/match-one").json()
    far_corner_img = CORNERS[2]
    label["calibrations"] = [{"fromTime": 0.0, "corners": CORNERS}]
    label["status"] = "done"
    label["shots"] = [
        {"id": "s0002", "time": 2.0, "hitter": "far", "type": "forehand", "result": "in", "closeCall": False,
         "pointEnd": "winner", "bounce": {"time": 2.6, "image": CORNERS[0], "court": [99, 99]}},
        {"id": "s0001", "time": 1.0, "hitter": "near", "type": "serve", "serveNumber": 1, "result": "in",
         "closeCall": False, "pointEnd": None, "bounce": {"time": 1.5, "image": far_corner_img}},
    ]
    res = c.put("/api/labels/match-one", json=label)
    assert res.status_code == 200, res.text
    saved = load_match(labels / "match-one.json")
    assert [s.id for s in saved.shots] == ["s0001", "s0002"]      # sorted by time
    assert saved.shots[0].bounce.court == pytest.approx((4.115, 11.885), abs=1e-3)
    assert saved.shots[1].bounce.court == pytest.approx((-4.115, -11.885), abs=1e-3)  # client value replaced
    listing = c.get("/api/videos").json()["videos"][0]
    assert (listing["status"], listing["shots"]) == ("done", 2)


def test_save_rejects_invalid_shots_with_a_reason(client):
    c, labels = client
    label = c.get("/api/labels/match-one").json()
    label["shots"] = [{"id": "s1", "time": 1.0, "hitter": "near", "type": "lob", "result": "in"}]
    res = c.put("/api/labels/match-one", json=label)
    assert res.status_code == 422
    assert "type must be one of" in res.json()["error"]
    assert not (labels / "match-one.json").exists()


def test_save_rejects_wrong_match(client):
    c, _ = client
    res = c.put("/api/labels/match-one", json={"matchId": "other", "shots": []})
    assert res.status_code == 400


def test_calibration_switches_at_its_start_time():
    cals = [{"fromTime": 0.0, "corners": "first"}, {"fromTime": 60.0, "corners": "second"}]
    assert calibration_at(cals, 30.0) == "first"
    assert calibration_at(cals, 60.0) == "second"
    assert calibration_at([{"fromTime": 10.0, "corners": "only"}], 0.0) == "only"


def test_bounce_without_calibration_has_no_court_position():
    raw = {"shots": [{"time": 1, "bounce": {"time": 1.2, "image": [0.5, 0.5], "court": [1, 1]}}]}
    assert fill_court_positions(raw)["shots"][0]["bounce"]["court"] is None


def test_saved_file_is_valid_json_even_when_written_twice(client):
    c, labels = client
    label = c.get("/api/labels/match-one").json()
    for _ in range(2):
        assert c.put("/api/labels/match-one", json=label).status_code == 200
    json.loads((labels / "match-one.json").read_text())
    assert not list(labels.glob(".tmp-*"))
