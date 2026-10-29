"""Footage review: file facts, framing, stability, lighting, verdicts, and the folder scan."""
import json
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import synthetic_match as sm  # noqa: E402
from intake import check as ck  # noqa: E402
from intake.__main__ import scan  # noqa: E402
from intake.metadata import NotAVideo, read_meta  # noqa: E402

FPS = 30


def court_frame(shift=(0, 0), brightness=1.0, size=(1920, 1080), seed=0):
    """One full-HD frame of the synthetic court, with camera grain like a real phone."""
    w, h = size
    cam = sm.Camera()
    img = np.full((sm.H, sm.W, 3), (70, 120, 60), np.uint8)
    from services import court_model as cm
    for a, b in cm.COURT_LINES_M[:-1]:
        pa, pb = cam.project((*a, 0)), cam.project((*b, 0))
        cv2.line(img, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), (235, 235, 235), 2, cv2.LINE_AA)
    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_LINEAR)
    if shift != (0, 0):
        img = cv2.warpAffine(img, np.float32([[1, 0, shift[0]], [0, 1, shift[1]]]), (w, h),
                             borderMode=cv2.BORDER_REPLICATE)
    rng = np.random.default_rng(seed)
    grain = rng.normal(0, 9, img.shape)
    return np.clip(img.astype(np.float32) * brightness + grain, 0, 255).astype(np.uint8)


def write_video(path, seconds, frame_for, size=(1920, 1080), fps=FPS):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    cache = {}
    for i in range(int(seconds * fps)):
        key = frame_for(i / fps)
        if key not in cache:
            cache = {key: court_frame(*key, size=size, seed=len(cache))}
        writer.write(cache[key])
    writer.release()
    return path


@pytest.fixture(scope="module")
def videos(tmp_path_factory):
    d = tmp_path_factory.mktemp("footage")
    return {
        "steady": write_video(d / "steady.mp4", 40, lambda t: ((0, 0), 1.0)),
        "bumped": write_video(d / "bumped.mp4", 40, lambda t: ((0, 0), 1.0) if t < 30 else ((40, 25), 1.0)),
        "dark": write_video(d / "dark.mp4", 20, lambda t: ((0, 0), 0.18)),
        "portrait": write_video(d / "portrait.mp4", 6, lambda t: ((0, 0), 1.0), size=(1080, 1920)),
        "small": write_video(d / "small.mp4", 6, lambda t: ((0, 0), 1.0), size=(480, 270)),
    }


def levels(review):
    return {f.check: f.level for f in review.findings}


def test_reads_file_facts(videos):
    meta = read_meta(videos["steady"])
    assert meta.display_size == (1920, 1080)
    assert meta.fps == pytest.approx(30)
    assert meta.duration == pytest.approx(40, abs=0.1)
    assert not meta.portrait and meta.hdr is None


def test_steady_full_court_is_usable(videos, monkeypatch):
    monkeypatch.setattr(ck, "STABILITY_EVERY", 3.0)
    r = ck.review(videos["steady"])
    found = levels(r)
    assert "framing" not in found and "court" not in found and "stability" not in found
    assert found.get("frame rate") == "note"          # 30 fps: fine, 60 is better
    assert r.level == "note" and r.verdict == "Usable, with notes"
    assert r.facts["court"]["confidence"] > 0.5


def test_camera_bump_keeps_the_part_before_it(videos):
    findings, facts = ck.check_stability(str(videos["bumped"]), read_meta(videos["bumped"]), every=3.0)
    assert findings and findings[0].level == "note"
    assert 26 <= facts["usableUntil"] <= 30
    assert "moved at 0:3" in findings[0].message


def test_early_bump_needs_a_rerecord(videos):
    meta = read_meta(videos["bumped"])
    meta.duration = 160.0                             # same bump at 0:30 is now in the first quarter
    findings, _ = ck.check_stability(str(videos["bumped"]), meta, every=3.0)
    assert findings[0].level == "fix"


def test_dark_portrait_and_tiny_are_flagged(videos):
    assert levels(ck.review(videos["dark"]))["lighting"] == "fix"
    r = ck.review(videos["portrait"])
    assert levels(r)["orientation"] == "fix" and r.verdict == "Needs a re-record"
    assert "landscape" in ck.friend_message(r)
    assert levels(ck.review(videos["small"]))["resolution"] == "fix"


def test_compression_and_hdr_from_metadata():
    from intake.metadata import VideoMeta
    meta = VideoMeta(file_bytes=int(1.2e6 / 8 * 600), width=1920, height=1080,
                                              fps=30, duration=600, codec="HEVC", transfer=18)
    found = {f.check: f for f in ck.check_file(meta)}
    assert found["compression"].level == "fix" and "Drive folder" in found["compression"].ask
    assert found["HDR"].level == "note"


def test_cut_off_baseline_is_a_framing_fix(videos):
    frame = court_frame()
    cropped = cv2.resize(frame[: int(0.8 * 1080)], (1920, 1080))   # zoomed so the near baseline is off screen
    findings, facts = ck.check_picture("x", read_meta(videos["steady"]), {10.0: cropped, 20.0: cropped})
    framing = [f for f in findings if f.check == "framing"]
    assert framing and framing[0].level == "fix" and "near baseline" in framing[0].message


def test_not_a_video(tmp_path):
    bad = tmp_path / "notes.mp4"
    bad.write_bytes(b"\x00\x00\x00\x08junk" * 10)
    r = ck.review(bad)
    assert r.verdict == "Needs a re-record" and r.findings[0].check == "file"
    with pytest.raises(NotAVideo):
        read_meta(bad)


def test_good_review_needs_no_message():
    r = ck.Review("a.mp4", "Good", "ok", [])
    assert ck.friend_message(r) is None


def test_scan_reviews_new_files_once(tmp_path, videos, monkeypatch):
    folder = tmp_path / "Match Footage"
    out = tmp_path / "review"
    folder.mkdir()
    for name in ("portrait", "small"):
        target = folder / f"{name}.mp4"
        target.write_bytes(videos[name].read_bytes())
        old = 1_700_000_000
        os.utime(target, (old, old))
    (folder / "notes.txt").write_text("not a video")
    monkeypatch.setattr("intake.__main__._ball_detector", lambda allow_missing=True: None)

    assert scan(folder, out) == 0
    state = json.loads((out / "review.json").read_text())
    assert sorted(e["file"] for e in state["entries"]) == ["portrait.mp4", "small.mp4"]
    assert len((out / "new.txt").read_text().splitlines()) == 2
    md = (out / "Review.md").read_text()
    assert "portrait.mp4: Needs a re-record" in md and "Draft to send:" in md

    scan(folder, out)                                   # nothing new the second time
    assert (out / "new.txt").read_text() == ""

    fresh = folder / "fresh.mp4"                        # still syncing: too new to review
    fresh.write_bytes(videos["small"].read_bytes())
    scan(folder, out)
    assert "fresh.mp4" not in (out / "review.json").read_text()
