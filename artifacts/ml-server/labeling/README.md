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
   - Press **J** to jump to the next hit. The tool finds hits from the sound of the ball in the video's own audio, on your computer, the first time you open a match (a minute or so; the line under the video shows progress). **Shift + J** goes back one. Hits are a place to stop and look, not labels: a loud bounce can be a stop, and a quiet hit can be missed, so step with **,** and **.** when it lands off the contact.
   - On the frame of contact, press the type: **S** serve, **F** forehand, **B** backhand, **V** volley, **O** overhead. Hitter and serve number are filled in for you; **H** switches the hitter, **1** and **2** set first or second serve, and **Shift** plus the letter changes the selected shot's type instead of adding one.
   - Step to the frame where the ball lands and click the bounce. The zoom box in the corner helps on close calls. The tool suggests in or out and shows how far from the line it landed; press **I** or **X** to correct it, **N** for net, **Z** if it was hit before bouncing.
   - Press **C** if it's a close call you weren't sure about.
   - On the last shot of a point, press **W** winner, **E** forced error, or **U** unforced error. A double fault is the second serve marked out with **U**. If the next shot isn't a serve, the tool shows a "Check" warning naming the shot (it doesn't block you).
4. Tick **Labeling done** when the match is finished. Only finished matches are scored.

It saves automatically. **Cmd + Z** undoes the last change (add, edit, bounce, delete, calibration) and **Shift + Cmd + Z** redoes it, so deleting doesn't ask first. The header shows where you are ("Shot 212 of 640 · 34:10 of 1:32:00 · 3 suggestions to check"). Reopening a match, even after closing the tab, puts you back on the same shot and video position (remembered in this browser). Every shortcut also has an on-screen button.

Hit times are cached in `labels/.hits/`, which git ignores and the eval never reads. Delete a file there to scan that match again.

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
