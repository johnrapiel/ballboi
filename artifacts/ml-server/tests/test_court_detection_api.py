"""
Endpoint-level tests for POST /detect-court-lines.

Covers:
- Authentication: missing / wrong / correct X-ML-Secret header
- Validation: missing required body field returns 422
- Invalid base64 payload returns 200 with success=False
- Valid synthetic court frame returns 200 with success=True and 4 corners
"""

import base64
import sys
import os
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as ml_main

TEST_SECRET = "test-ml-secret-value"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _encode_frame(img: np.ndarray) -> str:
    """Encode a BGR numpy array as a raw base64 JPEG string."""
    success, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert success, "cv2.imencode failed in test helper"
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def _synthetic_court_frame() -> str:
    """
    Minimal synthetic court: bright white lines on dark green background
    forming a clear rectangle (two baselines, two sidelines).
    480×360 gives well-separated corners that the detector can resolve.
    """
    h, w = 360, 480
    img = np.full((h, w, 3), (20, 80, 20), dtype=np.uint8)
    color, thickness = (255, 255, 255), 3
    cv2.line(img, (60, 60), (420, 60), color, thickness)
    cv2.line(img, (60, 300), (420, 300), color, thickness)
    cv2.line(img, (60, 60), (60, 300), color, thickness)
    cv2.line(img, (420, 60), (420, 300), color, thickness)
    return _encode_frame(img)


def _invalid_base64_payload() -> str:
    """Random bytes that cannot be decoded as an image."""
    return base64.b64encode(b"not image data at all").decode("utf-8")


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """TestClient with ML_SECRET configured."""
    with patch.object(ml_main, "_ML_SECRET", TEST_SECRET):
        with TestClient(ml_main.app, raise_server_exceptions=False) as c:
            yield c


@pytest.fixture(scope="module")
def valid_frame() -> str:
    return _synthetic_court_frame()


@pytest.fixture(scope="module")
def invalid_frame() -> str:
    return _invalid_base64_payload()


def _auth() -> dict:
    return {"X-ML-Secret": TEST_SECRET}


def _wrong_auth() -> dict:
    return {"X-ML-Secret": "wrong-secret"}


# ─── Authentication tests ──────────────────────────────────────────────────────

class TestDetectCourtLinesAuth:
    def test_missing_secret_returns_403(self, client, valid_frame):
        res = client.post("/detect-court-lines", json={"frame_image": valid_frame})
        assert res.status_code == 403

    def test_wrong_secret_returns_403(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_wrong_auth(),
        )
        assert res.status_code == 403

    def test_correct_secret_returns_200(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        assert res.status_code == 200, (
            f"Expected 200 with correct secret, got {res.status_code}: {res.text}"
        )


# ─── Request validation tests ─────────────────────────────────────────────────

class TestDetectCourtLinesValidation:
    def test_missing_frame_image_returns_422(self, client):
        """Body with no frame_image field must be rejected by FastAPI validation."""
        res = client.post("/detect-court-lines", json={}, headers=_auth())
        assert res.status_code == 422, (
            f"Expected 422 for missing frame_image, got {res.status_code}: {res.text}"
        )

    def test_null_frame_image_returns_422(self, client):
        """frame_image is a required str field; null should fail validation."""
        res = client.post(
            "/detect-court-lines", json={"frame_image": None}, headers=_auth()
        )
        assert res.status_code == 422, (
            f"Expected 422 for null frame_image, got {res.status_code}: {res.text}"
        )


# ─── Invalid payload tests ────────────────────────────────────────────────────

class TestDetectCourtLinesInvalidPayload:
    def test_invalid_base64_returns_200_with_failure(self, client, invalid_frame):
        """Non-image base64 must return 200 with success=False and an error message."""
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": invalid_frame},
            headers=_auth(),
        )
        assert res.status_code == 200, (
            f"Expected 200 for invalid base64, got {res.status_code}: {res.text}"
        )
        body = res.json()
        assert body["success"] is False, (
            f"Expected success=False for invalid base64, got: {body}"
        )
        assert body.get("error"), (
            "Expected a non-empty 'error' field for invalid base64"
        )

    def test_invalid_base64_has_no_corners(self, client, invalid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": invalid_frame},
            headers=_auth(),
        )
        body = res.json()
        assert not body.get("corners"), (
            "Expected no corners for an invalid frame"
        )

    def test_malformed_base64_string_returns_200_with_failure(self, client):
        """A string that is not valid base64 at all must not produce an unhandled 500."""
        malformed = "%%%not-valid-base64%%%"
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": malformed},
            headers=_auth(),
        )
        assert res.status_code == 200, (
            f"Expected 200 for malformed base64, got {res.status_code}: {res.text}"
        )
        body = res.json()
        assert body["success"] is False, (
            f"Expected success=False for malformed base64, got: {body}"
        )
        assert body.get("error"), (
            "Expected a non-empty 'error' field for malformed base64"
        )


# ─── Valid frame tests ────────────────────────────────────────────────────────

class TestDetectCourtLinesValidFrame:
    def test_returns_200(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        assert res.status_code == 200, (
            f"Expected 200, got {res.status_code}: {res.text}"
        )

    def test_success_flag_is_true(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        body = res.json()
        assert body["success"] is True, (
            f"Expected success=True for synthetic court frame, got: {body}"
        )

    def test_returns_four_corners(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        corners = res.json().get("corners", [])
        assert len(corners) == 4, (
            f"Expected 4 corners, got {len(corners)}: {corners}"
        )

    def test_corners_have_x_and_y_keys(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        for i, corner in enumerate(res.json().get("corners", [])):
            assert "x" in corner and "y" in corner, (
                f"Corner {i} missing 'x' or 'y': {corner}"
            )

    def test_corner_coordinates_are_normalised(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        for i, corner in enumerate(res.json().get("corners", [])):
            assert 0.0 <= corner["x"] <= 1.0, (
                f"Corner {i} x={corner['x']} outside [0, 1]"
            )
            assert 0.0 <= corner["y"] <= 1.0, (
                f"Corner {i} y={corner['y']} outside [0, 1]"
            )

    def test_confidence_is_in_unit_range(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        confidence = res.json().get("confidence")
        assert isinstance(confidence, (int, float)), (
            f"Expected numeric confidence, got {type(confidence)}"
        )
        assert 0.0 <= confidence <= 1.0, (
            f"Confidence {confidence} outside [0.0, 1.0]"
        )

    def test_lines_detected_is_positive(self, client, valid_frame):
        res = client.post(
            "/detect-court-lines",
            json={"frame_image": valid_frame},
            headers=_auth(),
        )
        lines_detected = res.json().get("lines_detected")
        assert isinstance(lines_detected, int) and lines_detected > 0, (
            f"Expected positive int for lines_detected, got {lines_detected}"
        )
