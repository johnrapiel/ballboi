"""Hit finding for the labeling tool's J key: from the video's own sound, on this computer."""
import json
import os
import shutil
import subprocess
import sys
import time
import wave

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from labeling.hits import SAMPLE_RATE, detect_hits, onset_strength, pick_hits  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg isn't installed")
FRAME_S = 1 / 30


def rally_audio(seconds=60.0, seed=3):
    """Court noise, racket hits in rallies with quiet gaps, softer bounces, and faint hits from the next court."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SAMPLE_RATE)
    x = rng.normal(0, 0.02, n).astype(np.float32)
    x += 0.05 * np.sin(2 * np.pi * 80 * np.arange(n) / SAMPLE_RATE).astype(np.float32)

    def burst(at, amp, f0, length=0.012, rise=0.0005):
        k = int(length * SAMPLE_RATE)
        i = int(at * SAMPLE_RATE)
        m = np.arange(k)
        env = np.exp(-m / (k / 5)) * np.minimum(1, m / (rise * SAMPLE_RATE))
        x[i:i + k] += (amp * env * np.sin(2 * np.pi * f0 * m / SAMPLE_RATE)).astype(np.float32)

    hits, t = [], 2.0
    while t < seconds - 3:
        for _ in range(rng.integers(3, 8)):
            hits.append(round(t, 3))
            t += rng.uniform(0.9, 1.6)
        t += rng.uniform(6, 12)
    for h in hits:
        burst(h, rng.uniform(0.15, 0.5), rng.uniform(1500, 3500))
        burst(h + 0.45, 0.3, 150, 0.03, 0.004)       # bounce: a low thud
    for at in rng.uniform(0, seconds - 1, 15):
        burst(at, 0.03, 2500)                         # the next court, far away
    return x, hits


def test_finds_every_hit_within_a_frame_and_skips_bounces():
    x, hits = rally_audio()
    found = np.array([h["time"] for h in pick_hits(onset_strength(x))])
    for h in hits:
        assert np.min(np.abs(found - h)) <= FRAME_S, f"missed the hit at {h}"
    extras = [f for f in found if np.min(np.abs(np.array(hits) - f)) > FRAME_S]
    assert len(extras) <= max(2, len(hits) // 10), extras


def test_silence_has_no_hits():
    assert pick_hits(onset_strength(np.zeros(SAMPLE_RATE * 5, dtype=np.float32))) == []
    assert pick_hits(np.zeros(0, dtype=np.float32)) == []


def test_streaming_matches_one_pass():
    from labeling.hits import _Flux
    x, _ = rally_audio(seconds=20)
    f = _Flux()
    for i in range(0, x.size, 12345):     # odd chunk sizes, like a pipe
        f.feed(x[i:i + 12345])
    assert np.allclose(f.result(), onset_strength(x), atol=1e-3)


def write_wav(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def make_match(path, seconds=30.0, audio=True):
    x, hits = rally_audio(seconds)
    wav = path.with_suffix(".wav")
    write_wav(wav, x)
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=green:s=160x90:r=30:d={seconds}"]
    if audio:
        cmd += ["-i", str(wav), "-c:a", "aac", "-shortest"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True)
    wav.unlink()
    return hits


@needs_ffmpeg
def test_detects_hits_from_a_video_file(tmp_path):
    video = tmp_path / "m.mp4"
    hits = make_match(video)
    found = np.array([h["time"] for h in detect_hits(video, duration=30.0)])
    # AAC adds a few ms of delay at the start; still well within a frame.
    for h in hits:
        assert np.min(np.abs(found - h)) <= FRAME_S


@needs_ffmpeg
def test_video_without_sound_says_so(tmp_path):
    from labeling.hits import NoAudio
    video = tmp_path / "silent.mp4"
    make_match(video, seconds=2, audio=False)
    with pytest.raises(NoAudio):
        detect_hits(video)


@needs_ffmpeg
def test_hits_endpoint_scans_once_and_caches_next_to_labels(tmp_path):
    from test_labeling import Client, serve
    from labeling.app import create_app

    videos, labels = tmp_path / "videos", tmp_path / "labels"
    videos.mkdir()
    hits = make_match(videos / "match-one.mp4")
    server, thread, base = serve(create_app(videos, labels))
    try:
        client = Client(base)
        assert client.get("/api/hits/nope").status_code == 404
        body = client.get("/api/hits/match-one").json()
        for _ in range(200):
            if body["state"] != "running":
                break
            time.sleep(0.05)
            body = client.get("/api/hits/match-one").json()
        assert body["state"] == "done", body
        assert len(body["hits"]) >= len(hits)
        cache = labels / ".hits" / "match-one.json"
        assert cache.is_file()
        # Cached: a second request doesn't scan again.
        cache.write_text(json.dumps({**json.loads(cache.read_text()), "hits": [{"time": 1.0, "strength": 9}]}))
        assert client.get("/api/hits/match-one").json()["hits"] == [{"time": 1.0, "strength": 9}]
        # The eval never reads the cache as a label file.
        from evaluation.schema import load_dir
        assert load_dir(labels) == {}
    finally:
        server.should_exit = True
        thread.join(timeout=5)
