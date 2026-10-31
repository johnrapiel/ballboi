"""
The training copy of a match: video only, no audio.

Spec (Video and training data): raw video is deleted after analysis unless the
match is kept for training, and audio is deleted after processing either way.
So when the API says a match may be kept (both players left training on), the
ML server makes a copy with the audio track removed and uploads it next to the
raw upload. The API then deletes the raw upload, which is the only copy with
audio. Nothing is re-encoded: the video stream is copied as is.

If anything fails, there's simply no training copy. That's the safe side: the
match is deleted like any other.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

TRAINING_PREFIX = "/objects/training/"


def training_key(session_id: int) -> str:
    return f"{TRAINING_PREFIX}session-{int(session_id)}.mp4"


def video_only_copy(src: str, dst: str) -> None:
    """Copies the video stream into an MP4 with no audio, subtitle or data tracks."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg isn't installed")
    subprocess.run(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-i", src,
         "-map", "0:v:0", "-c", "copy", "-an", "-sn", "-dn", "-map_metadata", "-1",
         "-movflags", "+faststart", dst],
        check=True, capture_output=True, timeout=3600,
    )


def make_training_copy(video_path: str, session_id: int, upload=None) -> str | None:
    """Uploads a video-only copy and returns its object path, or None if it couldn't."""
    if upload is None:
        from services.storage import upload
    fd, tmp = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        video_only_copy(video_path, tmp)
        return upload(tmp, training_key(session_id))
    except Exception as e:  # never fail the analysis over this
        logger.warning(f"No training copy for session {session_id}: {e}")
        return None
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
