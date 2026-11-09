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

On your Mac, the viewer runs in Docker with the real models: `bash scripts/mac/open-viewer.sh` (or double-click **Open analysis viewer** in `scripts/mac`). Videos come straight from the Match Footage Drive folder; labels and analysis results are saved in `evaluation/labels` and `evaluation/analysis`.

1. **Calibrate the court first** (K). The analysis uses your corners, like the app uses the phone's.
2. **Pick a stretch:** set From and To (minutes:seconds), or press **Next 2 minutes from here**. On this Mac's processor, analysis takes about three times as long as the stretch itself, so start with a few minutes, not the whole match.
3. **Run analysis.** When it finishes, the video shows the ball's path in yellow, the shot type at each hit, and a dashed square on each bounce with In, Out, or Close call written next to it. The table lists every shot it found, and the "Your label" column says whether it matches yours.
4. **Use as labels** copies the analysis's shots into your labels as suggestions, marked **Suggested**. The list switches to "Suggestions to check first," starting with the ones the analysis was least sure about. For each one, check it against the video: press **Y** if it's right, or fix any field (that confirms it too). Delete shots that didn't happen and add any it missed.

A match can't be marked done until every suggestion has been checked. The eval report says how many labels came from suggestions accepted unchanged, because a high share can make the scores look better than they are.

## Label beta recordings

Matches beta testers record in the app can join the test set. Only matches that may be used for testing come down: the person who recorded it agreed to the Beta Footage Release, the match is held for beta, and nobody in it withdrew. Placeholder opponents are fine for testing; the training toggle doesn't matter here. Recordings show up once Ball Boi has analyzed them, because that's when the video-only copy is made (no audio, so **J** has no hit sounds to jump to on these; step with **,** and **.**).

**One-time setup.** The download signs in as you, using two lines that are probably already in `~/ballboi/.env` from running Ball Boi locally:

```sh
CLERK_SECRET_KEY=sk_test_...      # dashboard.clerk.com > Ball Boi Development instance > API Keys > Secret keys
ADMIN_EMAIL=you@example.com       # the email you sign in to Ball Boi with; same as the staging API's ADMIN_EMAIL secret
```

Staging uses the same Clerk Development instance as local, so it's the same key. No R2 token is needed: the staging API checks who agreed and who withdrew, then hands back download links that work for two hours. Never paste these keys in chat. To use a different API, add `BALLBOI_STAGING_API_URL=`; to save somewhere else, add `BALLBOI_BETA_FOLDER=`.

**Each time:**

1. In Finder, open `~/ballboi/artifacts/ml-server/scripts/mac` and double-click **Download beta recordings** (copy it to your Desktop if you like). New matches download into `~/BallBoiTestSet/Beta` as `2026-11-08-beta-match-123.mp4` (recording date and match ID). Ones you already have are skipped, and an interrupted download picks up where it stopped next time.
2. Double-click **Open analysis viewer (beta)**. The labeling tool lists the beta recordings. Without Docker: `cd ~/ballboi/artifacts/ml-server && python3 -m labeling --beta`.

The download only reads. It never deletes or changes anything in Ball Boi's storage, the database or your folder. If a player later withdraws, the next download names the file on your Mac to delete (the release promises it's gone within 30 days). Labels you made can stay; they don't have names in them.

**Cost:** nothing. Downloads from Cloudflare R2 are free (R2 doesn't charge for data going out), and the few requests each run makes are far inside R2's free monthly allowance. The video goes from Ball Boi's R2 bucket straight to your Mac; no other service sees it.

**Docker:** the viewer runs in Docker Desktop. If it isn't installed, install Docker Desktop for Mac (Intel chip) from docker.com and open it once. The first time the viewer runs, it builds the analysis image, which takes 10 to 20 minutes once.
