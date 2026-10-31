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

## Analysis viewer

The same page shows what the shot analysis finds, so you can check it against the video and use it as a head start on labels.

On your Mac, the viewer runs in Docker with the real models: `bash scripts/mac/open-viewer.sh` (or double-click **Open analysis viewer**). Videos come straight from the Match Footage Drive folder; labels and analysis results are saved in `evaluation/labels` and `evaluation/analysis`.

1. **Calibrate the court first** (K). The analysis uses your corners, like the app uses the phone's.
2. **Pick a stretch:** set From and To (minutes:seconds), or press **Next 2 minutes from here**. On this Mac's processor, analysis takes about three times as long as the stretch itself, so start with a few minutes, not the whole match.
3. **Run analysis.** When it finishes, the video shows the ball's path in yellow, the shot type at each hit, and a dashed square on each bounce with In, Out, or Close call written next to it. The table lists every shot it found, and the "Your label" column says whether it matches yours.
4. **Use as labels** copies the analysis's shots into your labels as suggestions, marked **Suggested**. The list switches to "Suggestions to check first," starting with the ones the analysis was least sure about. For each one, check it against the video: press **Y** if it's right, or fix any field (that confirms it too). Delete shots that didn't happen and add any it missed.

A match can't be marked done until every suggestion has been checked. The eval report says how many labels came from suggestions accepted unchanged, because a high share can make the scores look better than they are.
