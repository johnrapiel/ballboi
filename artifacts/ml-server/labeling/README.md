# Ball Boi labeling tool

A page on your own computer for labeling test-set matches. Each match becomes one file in `evaluation/labels/`, in the format the eval scores. Video stays on your computer; the tool only reads it.

## Start it

```sh
cd ~/ballboi/artifacts/ml-server
python3 -m labeling --videos ~/BallBoiTestSet
```

Your browser opens `http://127.0.0.1:8010`. The tool only listens on your own computer. Name each video after the match, e.g. `2026-11-02-bubble-night.mp4`; the file name becomes the match ID.

## Label a match

1. **Calibrate:** pause on a clear frame, press **K**, then click the four singles-court corners in the order shown (near-left, near-right, far-right, far-left). White lines are drawn over the court; if they don't sit on the real lines, press **K** again. If the phone moves mid-match, recalibrate from that frame.
2. **Fill in match details:** venue, surface, lighting, level. The eval breaks results down by these.
3. **For each shot:**
   - Step to the frame of contact (**,** and **.** move one frame) and press the type: **S** serve, **F** forehand, **B** backhand, **V** volley, **O** overhead. Hitter and serve number are filled in for you; **H** switches the hitter.
   - Step to the frame where the ball lands and click the bounce. The zoom box in the corner helps on close calls. The tool suggests in or out and shows how far from the line it landed; press **I** or **X** to correct it, **N** for net, **Z** if it was hit before bouncing.
   - Press **C** if it's a close call you weren't sure about.
   - On the last shot of a point, press **W** winner, **E** forced error, or **U** unforced error. A double fault is the second serve marked out with **U**.
4. Tick **Labeling done** when the match is finished. Only finished matches are scored.

It saves automatically. Every shortcut also has an on-screen button.

## What counts as what

- **Contact time:** the frame the racket meets the ball. The eval matches predictions within a quarter second.
- **Hitter:** the side of the net the player was on when they hit it, as the camera sees it (near or far).
- **Close call:** you flag it, or it landed within 10 cm of the line that decides it. The eval counts both.
- **Point ending:** winner (opponent couldn't reach it), forced error (opponent reached it but was under pressure), unforced error (a miss on a playable ball).
