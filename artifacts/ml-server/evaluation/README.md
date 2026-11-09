# Ball Boi eval

Scores the shot analysis pipeline against the labeled test set, so every model change gets a number before it ships. Per the spec, a stat that misses its bar is hidden at launch, not shown with a disclaimer.

## Launch bars

Set in `bars.json`:

| Stat | Bar | What it measures |
|---|---|---|
| Shot type | 90% | Labeled shots whose type (serve, forehand, backhand, volley, overhead) was right. A missed shot counts as wrong. |
| In or out, close calls | 85% | Labeled close calls called the right way. A close call is one the labeler flagged, or one that landed within 10 cm of the deciding line. |
| Serve placement | 85% | Labeled in-serves placed in the right box and lane (wide, body, T). Lanes are thirds of the box. |
| Point ending | 85% | Labeled points whose ending (winner, forced error, unforced error) was right. |
| Rally length | 85% | Labeled points whose rally length was within 1 shot. A point the pipeline didn't end within 2 seconds of the real one counts as wrong. |
| First serve % | 85% of matches | Matches whose first-serve % was within 5 points of the labeled one. The 85% share is a placeholder until John confirms it. |
| Placement | 80% | Labeled shots that landed in, placed in the right landing zone: each half of the singles court split into short (inside the service line) or deep, by left, middle or right third. |

The bars come from spec decision 98. Estimated serve speed isn't a launch stat until there's a way to measure it, so it's not scored and has no gate.

**How hiding works:** the committed report in `reports/latest/report.json` decides what the app shows. Every analysis result carries `statGates` (`gates.py`): a stat is shown only if that report came from the same pipeline and model files, the models aren't stand-ins, and the stat met its bar. The API blanks every hidden stat before it reaches the app. So after any model change, re-run the eval and commit the new report, or every stat goes back to hidden.

## Run it

```sh
cd artifacts/ml-server
python -m evaluation validate                         # check the label files
python -m evaluation score --predictions <folder> --out evaluation/reports/latest
python -m evaluation score --predictions <folder> --baseline evaluation/reports/baseline/report.json --check
```

The report shows each stat's score, a likely range (95% interval), whether it ships at launch, results by court and lighting, the most common mistakes, and a per-match table. With fewer than 50 examples behind a stat, the report says so: the score can still swing a lot.

`--check` exits with code 2 if any stat dropped more than 1 point below the baseline, so a model change can't quietly make things worse.

## Files

- `labels/<matchId>.json`: one labeled match, written by the labeling tool. Files starting with `_` are examples and are skipped. Format is documented in `schema.py`.
- Predictions use the same format, written by the pipeline, plus a `model` block naming the version.
- Video never goes in git. It lives in the private R2 test-set folder and on your Mac.

## Court coordinates

Meters, origin at the center of the net, `+x` to the right as seen from the camera, `+y` toward the far baseline. Defined in `services/court_model.py`, shared with the pipeline and labeling tool.
