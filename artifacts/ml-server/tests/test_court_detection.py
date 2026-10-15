"""
Unit tests for detect_court_lines_from_frame.

Covers:
- Valid synthetic court image (white lines on dark background) → 4 corners, success=True
- Blank (solid-black) image → success=False with an informative error message
- Corrupt / non-image data → success=False with decode error message
- All returned corner coordinates are within the normalised [0, 1] range
"""

import base64
import sys
import os

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.analyzer import detect_court_lines_from_frame


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _encode_frame(img: np.ndarray) -> str:
    """Encode a BGR numpy image as a base64 JPEG string."""
    success, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert success, "cv2.imencode failed in test fixture"
    return base64.b64encode(buf.tobytes()).decode("utf-8")


@pytest.fixture(scope="module")
def synthetic_court_frame() -> str:
    """
    Minimal synthetic court: four bright white lines on a dark green background
    forming a rectangle that clearly shows two horizontal baselines and two
    vertical sidelines.  Size 480×360 gives a min_dim of 360 → Hough
    minLineLength of 36 px, well below the ~200 px line segments we draw.
    """
    h, w = 360, 480
    img = np.full((h, w, 3), (20, 80, 20), dtype=np.uint8)  # dark green

    thickness = 3
    color = (255, 255, 255)  # white

    # Baselines (horizontal)
    cv2.line(img, (60, 60), (420, 60), color, thickness)    # far baseline
    cv2.line(img, (60, 300), (420, 300), color, thickness)  # near baseline

    # Sidelines (vertical)
    cv2.line(img, (60, 60), (60, 300), color, thickness)    # left sideline
    cv2.line(img, (420, 60), (420, 300), color, thickness)  # right sideline

    return _encode_frame(img)


@pytest.fixture(scope="module")
def blank_frame() -> str:
    """Solid black image — no lines at all."""
    img = np.zeros((360, 480, 3), dtype=np.uint8)
    return _encode_frame(img)


@pytest.fixture(scope="module")
def no_lines_frame() -> str:
    """
    Non-blank image with no detectable court structure: a uniform mid-gray
    fill, encoded losslessly as PNG so JPEG compression cannot introduce
    spurious edges.  The uniform value (128, 128, 128) sits below both the
    HSV white-mask threshold (V > 180) and the brightness threshold (> 195),
    so Canny produces no edges and Hough detects no line segments.
    This exercises the "not enough line segments detected" failure branch
    independently of the solid-black blank_frame case.
    """
    h, w = 360, 480
    img = np.full((h, w, 3), 128, dtype=np.uint8)
    success, buf = cv2.imencode(".png", img)
    assert success, "cv2.imencode (PNG) failed in no_lines_frame fixture"
    return base64.b64encode(buf.tobytes()).decode("utf-8")


@pytest.fixture(scope="module")
def corrupt_frame() -> str:
    """Random bytes that cannot be decoded as an image."""
    return base64.b64encode(b"this is not image data at all").decode("utf-8")


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestDetectCourtLinesValidFrame:
    def test_success_flag_is_true(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        assert result.get("success") is True, (
            f"Expected success=True, got: {result}"
        )

    def test_returns_four_corners(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        assert "corners" in result, "Result should contain 'corners'"
        assert len(result["corners"]) == 4, (
            f"Expected 4 corners, got {len(result['corners'])}"
        )

    def test_corners_have_x_and_y_keys(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        for i, corner in enumerate(result["corners"]):
            assert "x" in corner and "y" in corner, (
                f"Corner {i} is missing 'x' or 'y' key: {corner}"
            )

    def test_corner_coordinates_in_unit_range(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        for i, corner in enumerate(result["corners"]):
            assert 0.0 <= corner["x"] <= 1.0, (
                f"Corner {i} x={corner['x']} is outside [0, 1]"
            )
            assert 0.0 <= corner["y"] <= 1.0, (
                f"Corner {i} y={corner['y']} is outside [0, 1]"
            )

    def test_confidence_is_a_non_negative_number(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        confidence = result.get("confidence")
        assert isinstance(confidence, (int, float)), (
            f"Expected numeric confidence, got {type(confidence)}"
        )
        assert 0.0 <= confidence <= 1.0, (
            f"Confidence {confidence} is outside the valid [0.0, 1.0] range"
        )

    def test_lines_detected_is_positive_integer(self, synthetic_court_frame):
        result = detect_court_lines_from_frame(synthetic_court_frame)
        lines_detected = result.get("linesDetected")
        assert isinstance(lines_detected, int) and lines_detected > 0, (
            f"Expected positive int for linesDetected, got {lines_detected}"
        )


class TestDetectCourtLinesBlankImage:
    def test_success_flag_is_false(self, blank_frame):
        result = detect_court_lines_from_frame(blank_frame)
        assert result.get("success") is False, (
            f"Expected success=False for blank image, got: {result}"
        )

    def test_error_message_is_present(self, blank_frame):
        result = detect_court_lines_from_frame(blank_frame)
        assert "error" in result and result["error"], (
            "Expected a non-empty 'error' key for blank image"
        )

    def test_no_corners_returned(self, blank_frame):
        result = detect_court_lines_from_frame(blank_frame)
        assert "corners" not in result, (
            "Blank image result should not contain 'corners'"
        )


class TestDetectCourtLinesNoLines:
    def test_success_flag_is_false(self, no_lines_frame):
        result = detect_court_lines_from_frame(no_lines_frame)
        assert result.get("success") is False, (
            f"Expected success=False for noise image, got: {result}"
        )

    def test_error_message_is_present(self, no_lines_frame):
        result = detect_court_lines_from_frame(no_lines_frame)
        assert "error" in result and result["error"], (
            "Expected a non-empty 'error' key for noise image"
        )

    def test_no_corners_returned(self, no_lines_frame):
        result = detect_court_lines_from_frame(no_lines_frame)
        assert "corners" not in result, (
            "Noise image result should not contain 'corners'"
        )


class TestDetectCourtLinesCorruptData:
    def test_success_flag_is_false(self, corrupt_frame):
        result = detect_court_lines_from_frame(corrupt_frame)
        assert result.get("success") is False, (
            f"Expected success=False for corrupt data, got: {result}"
        )

    def test_error_message_mentions_decode(self, corrupt_frame):
        result = detect_court_lines_from_frame(corrupt_frame)
        error = result.get("error", "")
        assert error, "Expected a non-empty error message for corrupt data"
        assert any(word in error.lower() for word in ("decode", "failed", "detect")), (
            f"Error message does not describe the problem clearly: '{error}'"
        )
