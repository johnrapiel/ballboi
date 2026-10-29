"""
Reads what a phone video says about itself from its MP4/MOV header: size,
rotation, frame rate, length, codec, HDR, and bitrate. Pure Python, so it works
the same everywhere and doesn't need ffmpeg in the image.

Only the header boxes are read (moov, a few KB), never the video data.
"""
from __future__ import annotations

import math
import os
import struct
from dataclasses import dataclass, field
from typing import BinaryIO, Iterator

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts"}
VIDEO_CODECS = {
    b"avc1": "H.264", b"avc3": "H.264",
    b"hvc1": "HEVC", b"hev1": "HEVC",
    b"dvh1": "HEVC Dolby Vision", b"dvhe": "HEVC Dolby Vision",
    b"av01": "AV1", b"mp4v": "MPEG-4",
}
# ITU-T H.273 transfer characteristics
TRANSFER_HDR = {16: "HDR10 (PQ)", 18: "HLG"}


class NotAVideo(ValueError):
    pass


@dataclass
class VideoMeta:
    file_bytes: int
    width: int = 0              # as stored
    height: int = 0
    rotation: int = 0           # degrees clockwise the player applies
    fps: float = 0.0
    duration: float = 0.0
    frames: int = 0
    codec: str = "unknown"
    transfer: int | None = None
    dolby_vision: bool = False
    notes: list[str] = field(default_factory=list)

    @property
    def display_size(self) -> tuple[int, int]:
        return (self.height, self.width) if self.rotation in (90, 270) else (self.width, self.height)

    @property
    def portrait(self) -> bool:
        w, h = self.display_size
        return h > w

    @property
    def hdr(self) -> str | None:
        if self.dolby_vision:
            return "Dolby Vision"
        return TRANSFER_HDR.get(self.transfer) if self.transfer is not None else None

    @property
    def bitrate_mbps(self) -> float:
        return self.file_bytes * 8 / self.duration / 1e6 if self.duration > 0 else 0.0

    @property
    def bits_per_pixel(self) -> float:
        """Bitrate per pixel per frame: low values mean heavy recompression."""
        px = self.width * self.height * self.fps
        return self.bitrate_mbps * 1e6 / px if px else 0.0


def _boxes(f: BinaryIO, start: int, end: int) -> Iterator[tuple[bytes, int, int]]:
    """Yields (type, payload_start, box_end) for boxes between start and end."""
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        header = f.read(8)
        if len(header) < 8:
            return
        size, kind = struct.unpack(">I4s", header)
        payload = pos + 8
        if size == 1:
            size = struct.unpack(">Q", f.read(8))[0]
            payload = pos + 16
        elif size == 0:
            size = end - pos
        if size < 8 or pos + size > end:
            return
        yield kind, payload, pos + size
        pos += size


def _read(f: BinaryIO, at: int, n: int) -> bytes:
    f.seek(at)
    return f.read(n)


def _parse_sample_entry(f: BinaryIO, payload: int, end: int, meta: VideoMeta) -> None:
    # VisualSampleEntry: 6 reserved + 2 index + 16 pre-defined, then width, height ... 78 bytes in total
    w, h = struct.unpack(">HH", _read(f, payload + 24, 4))
    meta.width, meta.height = w, h
    for kind, p, e in _boxes(f, payload + 78, end):
        if kind == b"colr":
            colour_type = _read(f, p, 4)
            if colour_type in (b"nclx", b"nclc"):
                _, transfer, _ = struct.unpack(">HHH", _read(f, p + 4, 6))
                meta.transfer = transfer
        elif kind in (b"dvcC", b"dvvC", b"dvwC"):
            meta.dolby_vision = True


def _parse_video_track(f: BinaryIO, trak_payload: int, trak_end: int, meta: VideoMeta) -> bool:
    found_video = False
    timescale = duration = 0
    tkhd = None
    stsd = stts = None
    for kind, p, e in _boxes(f, trak_payload, trak_end):
        if kind == b"tkhd":
            tkhd = (p, e)
        elif kind == b"mdia":
            for k2, p2, e2 in _boxes(f, p, e):
                if k2 == b"hdlr":
                    found_video = _read(f, p2 + 8, 4) == b"vide"
                elif k2 == b"mdhd":
                    version = _read(f, p2, 1)[0]
                    if version == 1:
                        timescale, duration = struct.unpack(">IQ", _read(f, p2 + 20, 12))
                    else:
                        timescale, duration = struct.unpack(">II", _read(f, p2 + 12, 8))
                elif k2 == b"minf":
                    for k3, p3, e3 in _boxes(f, p2, e2):
                        if k3 == b"stbl":
                            for k4, p4, e4 in _boxes(f, p3, e3):
                                if k4 == b"stsd":
                                    stsd = (p4, e4)
                                elif k4 == b"stts":
                                    stts = (p4, e4)
    if not found_video:
        return False

    if timescale:
        meta.duration = duration / timescale
    if tkhd:
        p, _ = tkhd
        version = _read(f, p, 1)[0]
        matrix_at = p + (4 + 8 + 8 + 4 + 4 + 8 if version == 1 else 4 + 4 + 4 + 4 + 4 + 4) + 8 + 8
        a, b = struct.unpack(">ii", _read(f, matrix_at, 8))
        angle = round(math.degrees(math.atan2(b / 65536, a / 65536))) % 360
        meta.rotation = min((0, 90, 180, 270), key=lambda r: min(abs(angle - r), 360 - abs(angle - r)))
    if stsd:
        p, e = stsd
        entry_at = p + 8                           # version/flags + entry count
        size, kind = struct.unpack(">I4s", _read(f, entry_at, 8))
        meta.codec = VIDEO_CODECS.get(kind, kind.decode("latin-1"))
        if kind in (b"dvh1", b"dvhe"):
            meta.dolby_vision = True
        _parse_sample_entry(f, entry_at + 8, min(entry_at + size, e), meta)
    if stts and timescale:
        p, _ = stts
        (count,) = struct.unpack(">I", _read(f, p + 4, 4))
        total_frames = total_ticks = 0
        raw = _read(f, p + 8, 8 * min(count, 100000))
        for i in range(0, len(raw), 8):
            n, delta = struct.unpack(">II", raw[i:i + 8])
            total_frames += n
            total_ticks += n * delta
        meta.frames = total_frames
        if total_ticks:
            meta.fps = round(total_frames * timescale / total_ticks, 3)
    return True


def read_meta(path: str | os.PathLike) -> VideoMeta:
    size = os.path.getsize(path)
    meta = VideoMeta(file_bytes=size)
    with open(path, "rb") as f:
        top = list(_boxes(f, 0, size))
        if not top or top[0][0] not in (b"ftyp", b"wide", b"free", b"mdat", b"moov", b"skip"):
            raise NotAVideo(f"{os.path.basename(path)} isn't an MP4 or MOV video")
        moov = next(((p, e) for k, p, e in top if k == b"moov"), None)
        if moov is None:
            raise NotAVideo(f"{os.path.basename(path)} is incomplete (still uploading, or the recording was cut off)")
        for kind, p, e in _boxes(f, *moov):
            if kind == b"trak" and _parse_video_track(f, p, e, meta):
                break
    if not meta.width:
        raise NotAVideo(f"{os.path.basename(path)} has no video track")
    return meta
