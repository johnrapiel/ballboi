# Court test frames

Frames from John's first court test (Nov 8): a green hard court with white
tennis lines and pale yellow pickleball lines painted over them, filmed from
behind the near baseline, about 2 m up. The far baseline is hidden
behind the net. People and a dog are on court in most frames.

- `video-01.jpg` to `video-10.jpg`: one frame a second from a 10-second clip.
- `still-1.jpg`, `still-2.jpg`: two screenshots of the same clip.

All are upright and scaled to 480 x 270, the size the app runs court
detection at. The full-size originals are on the `assets/court-test-frames`
branch. These are test fixtures only: nothing imports them, so they never
reach the app bundle.

`corners.json` holds the four singles corners for each frame, normalized
(0 to 1 across and down), in calibration order: near left, near right, far
right, far left. They were labeled by hand on the full-size frames: each
visible line (near baseline, near service line, both singles and both
doubles sidelines, the centre service line) was placed by eye and snapped to
its painted pixels, then the corners were solved from all of their crossings.
The far corners sit behind the net, so they come from the visible lines, not
from paint. The near left corner is just off the left edge of the frame.

Used by `lib/__tests__/courtFrames.test.ts`.
