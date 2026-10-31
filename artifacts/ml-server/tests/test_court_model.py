"""Court geometry shared by the pipeline, labeling tool, and eval."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import court_model as cm  # noqa: E402

# A plausible fence-mount view: near corners wide at the bottom, far corners narrow near the top.
CORNERS = [[0.18, 0.92], [0.82, 0.92], [0.63, 0.31], [0.37, 0.31]]


def test_corners_map_to_court_corners():
    for img, court in zip(CORNERS, cm.SINGLES_CORNERS_M):
        x, y = cm.image_to_court(CORNERS, img)
        assert x == pytest.approx(court[0], abs=1e-6)
        assert y == pytest.approx(court[1], abs=1e-6)


def test_round_trip_court_to_image():
    for point in [(0.0, 0.0), (2.0, 6.4), (-3.9, -10.0), (1.1, 11.0)]:
        img = cm.court_to_image(CORNERS, point)
        back = cm.image_to_court(CORNERS, img)
        assert back == pytest.approx(point, abs=1e-6)


def test_homography_needs_four_points():
    with pytest.raises(ValueError):
        cm.image_to_court_matrix(CORNERS[:3])


@pytest.mark.parametrize(
    "x,y,hitter,inside",
    [
        (0.0, 5.0, "near", True),        # middle of the far half
        (4.10, 11.0, "near", True),      # just inside the sideline
        (4.20, 11.0, "near", False),     # just wide
        (0.0, 12.0, "near", False),      # long
        (0.0, -3.0, "near", False),      # never crossed the net
        (0.0, -5.0, "far", True),
        (-4.2, -5.0, "far", False),
    ],
)
def test_rally_in_out(x, y, hitter, inside):
    assert (cm.rally_target_distance(x, y, hitter) >= 0) is inside


def test_net_edge_never_decides_a_call():
    # A ball just over the net is deep inside the target, not a close call.
    assert cm.rally_target_distance(0.0, 0.05, "near") > 4.0


@pytest.mark.parametrize(
    "x,y,server,box,inside",
    [
        (-2.0, 5.0, "near", "deuce", True),   # far receiver's deuce box is image-left
        (2.0, 5.0, "near", "ad", True),
        (-2.0, 6.5, "near", "deuce", False),  # long
        (2.0, -5.0, "far", "deuce", True),    # near receiver's deuce box is image-right
        (-2.0, -5.0, "far", "ad", True),
    ],
)
def test_service_boxes(x, y, server, box, inside):
    found_box, d = cm.serve_target_distance(x, y, server)
    assert found_box == box
    assert (d >= 0) is inside


@pytest.mark.parametrize(
    "x,y,zone",
    [
        (-0.5, 5.0, "deuce_t"),
        (-2.0, 5.0, "deuce_body"),
        (-3.5, 5.0, "deuce_wide"),
        (0.5, 5.0, "ad_t"),
        (3.5, 5.0, "ad_wide"),
        (3.5, -5.0, "deuce_wide"),
        (0.0, 7.0, None),
    ],
)
def test_serve_zone(x, y, zone):
    assert cm.serve_zone(x, y) == zone


def test_line_distance_is_meters():
    d = cm.line_call_distance(4.0, 5.0, "near", is_serve=False)
    assert d == pytest.approx(0.115, abs=1e-9)
    assert np.isfinite(cm.line_call_distance(0.0, 6.3, "near", is_serve=True))
