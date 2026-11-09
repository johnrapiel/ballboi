"""
Finds ball-hit sounds in a match video's own audio, on this computer.

The labeling tool's J key jumps to the next hit, so dead time between points is
skipped. Nothing leaves the Mac: ffmpeg decodes the file's sound locally, numpy
finds the sharp "pock" of a racket hit, and the times are cached next to the
labels (labels/.hits/<matchId>.json) so each match is only scanned once.

How it finds hits: a racket hit is a short, sharp burst of sound between about
1 and 6 kHz. For every 8 ms of audio we measure how much louder that band just
got (spectral flux), then keep the peaks that stand well above the noise around
them, at least a third of a second apart. Footsteps, chatter and bounces from
the next court are quieter in that band, so they mostly fall below the bar. It
isn't perfect: the tool treats each hit as a place to stop and look, not a label.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np

DETECTOR_VERSION = 1
SAMPLE_RATE = 16_000
FRAME = 512                 # 32 ms window
HOP = 128                   # 8 ms between measurements
BAND_HZ = (1_000.0, 6_000.0)
MIN_GAP_S = 0.35            # two hits are never closer than this in singles
BLOCK_S = 4.0               # the "noise around it" is measured over blocks this long
THRESHOLD_MADS = 8.0        # how far above the local noise a peak must be
RELATIVE_FLOOR = 0.3        # and at least this share of a typical hit in the match
CHUNK_S = 30.0              # audio decoded and scanned this many seconds at a time


class NoAudio(RuntimeError):
    pass


class _Flux:
    """Streaming spectral flux in the hit band, one value per HOP samples."""

    def __init__(self, sr: int = SAMPLE_RATE):
        self.window = np.hanning(FRAME).astype(np.float32)
        freqs = np.fft.rfftfreq(FRAME, 1.0 / sr)
        self.band = (freqs >= BAND_HZ[0]) & (freqs <= BAND_HZ[1])
        self.buf = np.zeros(0, dtype=np.float32)
        self.prev: np.ndarray | None = None
        self.parts: list[np.ndarray] = []

    def feed(self, samples: np.ndarray) -> None:
        buf = np.concatenate([self.buf, samples.astype(np.float32, copy=False)])
        n = 0 if len(buf) < FRAME else 1 + (len(buf) - FRAME) // HOP
        if n == 0:
            self.buf = buf
            return
        frames = np.lib.stride_tricks.sliding_window_view(buf, FRAME)[::HOP][:n] * self.window
        mag = np.abs(np.fft.rfft(frames, axis=1))[:, self.band]
        stacked = mag if self.prev is None else np.vstack([self.prev, mag])
        flux = np.maximum(0.0, np.diff(stacked, axis=0)).sum(axis=1)
        if self.prev is None:
            flux = np.concatenate([[0.0], flux])
        self.parts.append(flux.astype(np.float32))
        self.prev = mag[-1:]
        self.buf = buf[n * HOP:]

    def result(self) -> np.ndarray:
        return np.concatenate(self.parts) if self.parts else np.zeros(0, dtype=np.float32)


def onset_strength(samples: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Spectral flux for a whole clip of mono samples in [-1, 1]."""
    f = _Flux(sr)
    f.feed(samples)
    return f.result()


def frame_time(i: np.ndarray | int, sr: int = SAMPLE_RATE) -> np.ndarray | float:
    """Time of a flux value: the center of its analysis window."""
    return (np.asarray(i) * HOP + FRAME / 2) / sr


def pick_hits(flux: np.ndarray, sr: int = SAMPLE_RATE, min_gap_s: float = MIN_GAP_S,
              threshold_mads: float = THRESHOLD_MADS, relative_floor: float = RELATIVE_FLOOR) -> list[dict]:
    """Peaks that stand out from the noise around them, strongest first wins, then sorted by time."""
    if flux.size == 0:
        return []
    hops_per_s = sr / HOP
    block = max(1, int(BLOCK_S * hops_per_s))
    n_blocks = int(np.ceil(flux.size / block))
    padded = np.full(n_blocks * block, np.nan, dtype=np.float32)
    padded[:flux.size] = flux
    blocks = padded.reshape(n_blocks, block)
    med = np.nanmedian(blocks, axis=1)
    mad = np.nanmedian(np.abs(blocks - med[:, None]), axis=1)
    # A quiet block (silence between points) would make anything look like a hit,
    # so the noise floor never drops below the whole match's.
    g_med = float(np.median(flux))
    g_mad = float(np.median(np.abs(flux - g_med)))
    floor = g_med + threshold_mads * max(g_mad, 1e-6)
    thr_blocks = np.maximum(med + threshold_mads * np.maximum(mad, 1e-6), floor)
    # Smooth across block edges.
    centers = (np.arange(n_blocks) + 0.5) * block
    thr = np.interp(np.arange(flux.size), centers, thr_blocks)

    candidates = np.flatnonzero(flux > thr)
    if candidates.size == 0:
        return []
    gap = max(1, int(round(min_gap_s * hops_per_s)))
    order = candidates[np.argsort(-flux[candidates], kind="stable")]
    blocked = np.zeros(flux.size, dtype=bool)
    kept = []
    for i in order:
        if blocked[i]:
            continue
        kept.append(int(i))
        blocked[max(0, i - gap):i + gap + 1] = True
    # Bounces, footsteps and the next court clear the noise but are much softer
    # than a racket hit, so drop peaks far below a typical hit in this match.
    typical = float(np.percentile(flux[kept], 75))
    kept = sorted(i for i in kept if flux[i] >= relative_floor * typical)
    return [{"time": round(float(frame_time(i, sr)), 3),
             "strength": round(float(flux[i] / max(thr[i], 1e-6)), 2)} for i in kept]


def detect_hits(video: Path, duration: float | None = None,
                progress: Callable[[float], None] | None = None) -> list[dict]:
    """Decodes the video's sound with ffmpeg (locally) and returns the hit times."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg isn't installed, so hits can't be found. On a Mac: brew install ffmpeg.")
    proc = subprocess.Popen(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    flux = _Flux()
    chunk_bytes = int(CHUNK_S * SAMPLE_RATE) * 2
    seen = 0
    leftover = b""
    assert proc.stdout is not None
    while True:
        data = proc.stdout.read(chunk_bytes)
        if not data:
            break
        data = leftover + data
        usable = len(data) - len(data) % 2
        leftover = data[usable:]
        samples = np.frombuffer(data[:usable], dtype="<i2").astype(np.float32) / 32768.0
        flux.feed(samples)
        seen += samples.size
        if progress and duration:
            progress(min(0.99, seen / (duration * SAMPLE_RATE)))
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    code = proc.wait()
    if seen == 0:
        if "does not contain any stream" in err or "matches no streams" in err or code == 0:
            raise NoAudio("This video has no sound, so hits can't be found. Step with , and . instead.")
        raise RuntimeError(f"ffmpeg couldn't read the sound: {err.strip()[:200] or code}")
    return pick_hits(flux.result())


def _fingerprint(video: Path) -> dict:
    st = video.stat()
    return {"file": video.name, "size": st.st_size, "mtime": int(st.st_mtime)}


class HitJobs:
    """Finds hits for one match at a time in a background thread; caches results per match."""

    def __init__(self, cache_dir: Path, write: Callable[[Path, dict], None]):
        self.dir = cache_dir
        self.write = write
        self.lock = threading.Lock()
        self.state: dict[str, dict] = {}

    def path(self, match_id: str) -> Path:
        return self.dir / f"{match_id}.json"

    def cached(self, match_id: str, video: Path) -> dict | None:
        p = self.path(match_id)
        if not p.is_file():
            return None
        try:
            raw = json.loads(p.read_text())
        except (OSError, ValueError):
            return None
        if raw.get("version") != DETECTOR_VERSION or raw.get("video") != _fingerprint(video):
            return None  # a different file or an older detector: scan again
        return raw

    def get(self, match_id: str, video: Path, duration: float | None) -> dict:
        """The cached hits, or the scan's progress (starting it if needed)."""
        hit = self.cached(match_id, video)
        if hit is not None:
            return {"state": "done", **hit}
        with self.lock:
            st = self.state.get(match_id)
            if st and st["state"] == "running":
                return dict(st)
            if st and st["state"] == "error" and st.get("fingerprint") == _fingerprint(video):
                return dict(st)
            st = {"state": "running", "progress": 0.0, "startedAt": time.time(),
                  "fingerprint": _fingerprint(video)}
            self.state[match_id] = st
        threading.Thread(target=self._run, args=(match_id, video, duration, st), daemon=True).start()
        return dict(st)

    def _run(self, match_id: str, video: Path, duration: float | None, st: dict) -> None:
        try:
            hits = detect_hits(video, duration, progress=lambda p: st.__setitem__("progress", round(p, 3)))
            self.write(self.path(match_id), {
                "version": DETECTOR_VERSION, "matchId": match_id, "video": _fingerprint(video),
                "seconds": round(time.time() - st["startedAt"], 1), "hits": hits,
            })
            with self.lock:
                self.state.pop(match_id, None)
        except Exception as exc:  # shown in the page, never crashes the server
            st.update(state="error", message=str(exc) or type(exc).__name__)
