"""
Which models the pipeline runs, and the version name every result carries.

Model files live in BALLBOI_MODELS_DIR (default: artifacts/ml-server/models),
never in git. The Docker image builds them; see the ML server README.
"""
from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from services.pipeline.ball import BallDetector, MotionDetector, WASBDetector
from services.pipeline.players import PeopleModel, PoseModel

log = logging.getLogger(__name__)

ML_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS_DIR = ML_ROOT / "models"
FILES = {
    "ball": "wasb_tennis.onnx",
    "people": "yolox_m_humanart.onnx",
    "pose": "rtmpose_m_body7.onnx",
}
# Source that defines pipeline behavior. A change to any of these is a new model version.
SOURCE_FILES = [
    ML_ROOT / "services" / "court_model.py",
    *sorted((ML_ROOT / "services" / "pipeline").glob("*.py")),
]


class ModelsMissing(RuntimeError):
    pass


@dataclass
class Models:
    ball: BallDetector
    people: PeopleModel | None
    files: dict[str, Path] = field(default_factory=dict)

    @property
    def degraded(self) -> bool:
        return self.people is None or isinstance(self.ball, MotionDetector)

    def describe(self) -> dict:
        return {
            "version": pipeline_version(self.files),
            "sourceVersion": pipeline_version(),
            "ball": self.ball.name,
            "people": getattr(self.people, "name", None),
            "degraded": self.degraded,
        }


def models_dir() -> Path:
    return Path(os.environ.get("BALLBOI_MODELS_DIR", DEFAULT_MODELS_DIR)).expanduser()


def _digest(path: Path, h) -> None:
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)


def pipeline_version(files: dict[str, Path] | None = None) -> str:
    """
    Short hash of the pipeline source plus the model files in use. Without files,
    it's the source alone (the "sourceVersion" every result also carries).
    """
    h = hashlib.sha256()
    for p in SOURCE_FILES:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    for name, path in sorted((files or {}).items()):
        h.update(name.encode())
        _digest(path, h)
    return "pipeline-" + h.hexdigest()[:10]


def load_models(directory: Path | None = None, allow_fallback: bool = False, threads: int | None = None) -> Models:
    d = directory or models_dir()
    paths = {k: d / v for k, v in FILES.items()}
    missing = [str(p) for p in paths.values() if not p.is_file()]
    if missing and not allow_fallback:
        raise ModelsMissing("Analysis models aren't installed: " + ", ".join(missing))

    files: dict[str, Path] = {}
    if paths["ball"].is_file():
        ball: BallDetector = WASBDetector(str(paths["ball"]), threads=threads)
        files["ball"] = paths["ball"]
    else:
        log.warning("Ball model missing (%s); using the motion fallback", paths["ball"])
        ball = MotionDetector()

    people: PeopleModel | None = None
    if paths["people"].is_file() and paths["pose"].is_file():
        people = PoseModel(str(paths["people"]), str(paths["pose"]), threads=threads)
        files["people"] = paths["people"]
        files["pose"] = paths["pose"]
    else:
        log.warning("People or pose model missing; shot types will be rough")
    return Models(ball=ball, people=people, files=files)
