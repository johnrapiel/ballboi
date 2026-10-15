"""
Tests for X-ML-Secret authentication on the ML server endpoints.

Covers:
- /analyze, /analyze-match-live, /analyze-match-batch return 403 when the
  X-ML-Secret header is missing or contains a wrong value
- Requests carrying the correct X-ML-Secret header are not rejected (auth passes)
"""
import sys
import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as ml_main

TEST_SECRET = "test-ml-secret-value"

_ANALYZE_BODY = {
    "video_url": "http://example.com/video.mp4",
    "recording_id": 1,
    "callback_url": "http://example.com/callback",
}

_LIVE_BODY = {
    "session_id": 1,
    "timestamp_seconds": 0.0,
}

_BATCH_BODY = {
    "video_url": "http://example.com/video.mp4",
    "session_id": 1,
    "match_id": 1,
    "callback_url": "http://example.com/callback",
}


@pytest.fixture
def client():
    """TestClient with ML_SECRET configured; background-task exceptions are suppressed."""
    with patch.object(ml_main, "_ML_SECRET", TEST_SECRET):
        with TestClient(ml_main.app, raise_server_exceptions=False) as c:
            yield c


def _correct() -> dict:
    return {"X-ML-Secret": TEST_SECRET}


def _wrong() -> dict:
    return {"X-ML-Secret": "not-the-right-secret"}


# ─── /analyze ─────────────────────────────────────────────────────────────────

class TestAnalyzeAuth:
    def test_missing_secret_returns_403(self, client):
        res = client.post("/analyze", json=_ANALYZE_BODY)
        assert res.status_code == 403

    def test_wrong_secret_returns_403(self, client):
        res = client.post("/analyze", json=_ANALYZE_BODY, headers=_wrong())
        assert res.status_code == 403

    def test_correct_secret_is_accepted(self, client):
        with patch.object(ml_main, "process_and_callback", return_value=None):
            res = client.post("/analyze", json=_ANALYZE_BODY, headers=_correct())
        assert res.status_code == 200, (
            f"Expected 200 from /analyze with correct secret, got {res.status_code}"
        )


# ─── /analyze-match-live ──────────────────────────────────────────────────────

class TestAnalyzeMatchLiveAuth:
    def test_missing_secret_returns_403(self, client):
        res = client.post("/analyze-match-live", json=_LIVE_BODY)
        assert res.status_code == 403

    def test_wrong_secret_returns_403(self, client):
        res = client.post("/analyze-match-live", json=_LIVE_BODY, headers=_wrong())
        assert res.status_code == 403

    def test_correct_secret_is_accepted(self, client):
        res = client.post("/analyze-match-live", json=_LIVE_BODY, headers=_correct())
        assert res.status_code == 200, (
            f"Expected 200 from /analyze-match-live with correct secret, got {res.status_code}"
        )


# ─── /analyze-match-batch ─────────────────────────────────────────────────────

class TestAnalyzeMatchBatchAuth:
    def test_missing_secret_returns_403(self, client):
        res = client.post("/analyze-match-batch", json=_BATCH_BODY)
        assert res.status_code == 403

    def test_wrong_secret_returns_403(self, client):
        res = client.post("/analyze-match-batch", json=_BATCH_BODY, headers=_wrong())
        assert res.status_code == 403

    def test_correct_secret_is_accepted(self, client):
        with patch.object(ml_main, "process_match_and_callback", return_value=None):
            res = client.post("/analyze-match-batch", json=_BATCH_BODY, headers=_correct())
        assert res.status_code == 200, (
            f"Expected 200 from /analyze-match-batch with correct secret, got {res.status_code}"
        )
