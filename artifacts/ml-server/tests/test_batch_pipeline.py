"""The /analyze-match-batch path: pipeline result or a plain failure goes back to the API callback."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
pytest.importorskip("fastapi")

import main  # noqa: E402
from services.pipeline import run as run_mod  # noqa: E402
from services.pipeline.models import ModelsMissing  # noqa: E402


@pytest.fixture
def sent(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(main, "_post_callback", lambda url, payload: calls.append((url, payload)))
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(main, "download_video", lambda url: str(video))
    return calls


def test_success_posts_shots(monkeypatch, sent):
    monkeypatch.setattr(main, "_pipeline_models", lambda: object())
    monkeypatch.setattr(run_mod, "analyze_match", lambda *a, **k: {"shots": [{"shotType": "serve"}]})
    main.process_match_and_callback("http://v", 7, 3, "http://cb", None)
    url, payload = sent[0]
    assert payload["status"] == "completed"
    assert payload["result"]["sessionId"] == 7 and payload["result"]["shots"]


def test_missing_models_fail_with_a_reason(monkeypatch, sent):
    def boom():
        raise ModelsMissing("Analysis models aren't installed: models/wasb_tennis.onnx")
    monkeypatch.setattr(main, "_pipeline_models", boom)
    main.process_match_and_callback("http://v", 7, 3, "http://cb", None)
    assert sent[0][1]["status"] == "failed"
    assert "aren't installed" in sent[0][1]["error"]


def test_unexpected_errors_stay_generic(monkeypatch, sent):
    monkeypatch.setattr(main, "_pipeline_models", lambda: object())

    def crash(*a, **k):
        raise RuntimeError("stack details")
    monkeypatch.setattr(run_mod, "analyze_match", crash)
    main.process_match_and_callback("http://v", 7, 3, "http://cb", None)
    assert sent[0][1]["error"] == "Analysis failed. Please try again."

