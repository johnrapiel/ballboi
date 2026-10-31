# Ball Boi eval

Scores the shot analysis pipeline against the labeled test set, so every model change gets a number before it ships. Per the spec, a stat that misses its bar is hidden at launch, not shown with a disclaimer.

## Launch bars

Set in `bars.json`:

| Stat | Bar | What it measures |
|---|---|---|
| Shot type | 90% | Labeled shots whose type (serve, forehand, backhand, volley, overhead) was right. A missed shot counts as wrong. |
| In or out, close calls | 85% | Labeled close calls called the right way. A close call is one the labeler flagged, or one that landed within 10 cm of the deciding line. |
| Serve placement | 85% | Labeled in-serves placed in the right box and lane (wide, body, T). Lanes are thirds of the box. |

Point endings, rally length, first serve %, and landing heatmaps are scored too but have no bar yet, so they stay hidden until one is set.

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
