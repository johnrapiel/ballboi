# Ball Boi ML server

Turns a match recording into shots, line calls, and points. The API sends a video and the phone's four court corners to `/analyze-match-batch`; the result comes back to the API's shot callback.

## What's inside

| Part | Where | What it does |
|---|---|---|
| Pipeline | `services/pipeline/` | Court, ball tracking, players and pose, hits and bounces, shot types, line calls, points |
| Court geometry | `services/court_model.py` | ITF court in meters; shared with the eval and the labeling tool |
| R2 reading | `services/storage.py` | Downloads video with the API's `S3_*` settings |
| Training copy | `services/training_copy.py` | When the API sends `keep_for_training`, uploads a video-only copy (audio removed with ffmpeg, no re-encoding) to `/objects/training/` |
| Eval | `evaluation/` | Scores the pipeline against the labeled test set ([README](evaluation/README.md)) |
| Labeling tool | `labeling/` | Labels the test set ([README](labeling/README.md)) |
| Legacy | `services/analyzer.py` | Old single-shot and live-frame endpoints, kept until the API stops calling them |

## Models

All open source, permissively licensed, and run on CPU through ONNX Runtime:

| Job | Model | License |
|---|---|---|
| Ball | WASB, tennis weights ([NTT Communications](https://github.com/nttcom/WASB-SBDT)) | MIT |
| People | YOLOX-m (OpenMMLab build) | Apache-2.0 |
| Pose | RTMPose-m, body (OpenMMLab) | Apache-2.0 |
| Court | No weights: painted-line detection fitted to the court model; the phone's corners win when sent | Ours |

Left out on purpose: `ultralytics` (AGPL-3.0, would force publishing the server source) and the popular `yastrebksv` tennis ball and court models (no license, so no commercial use).

The pretrained weights were trained on public research datasets (broadcast tennis for WASB; common pose datasets for RTMPose). That's part of the launch legal review the spec already calls for; fine-tuning on Ball Boi's own labeled footage replaces that dependency over time.

## Run it

Docker is the way on every machine, including Intel Macs (PyTorch stopped shipping Intel Mac builds; the image is Linux). The first build downloads and exports the models, about 250 MB:

```sh
cd ~/ballboi
docker build -t ballboi-ml artifacts/ml-server
docker run --rm -p 8000:8000 --env-file .env ballboi-ml
```

To copy the models out for running the eval outside Docker:

```sh
docker create --name bbml ballboi-ml && docker cp bbml:/app/models artifacts/ml-server/models && docker rm bbml
```

## Score a model change

Every change to the pipeline or a model gets scored against the labeled set before it merges:

```sh
docker run --rm -v ~/BallBoiTestSet:/videos \
  -v "$PWD/artifacts/ml-server/evaluation:/app/evaluation" -v "$PWD/artifacts/ml-server/predictions:/app/predictions" \
  ballboi-ml python -m evaluation run --videos /videos --baseline evaluation/reports/baseline/report.json --check
```

The report lands in `evaluation/reports/latest/`; commit it with the change. A test fails if the committed report doesn't match the current pipeline code. Predictions are cached per pipeline version, so re-scoring is instant.

## Speed and cost

CPU only, no GPU service. The ball model runs on every frame; people and pose run only at candidate hits. I couldn't time the real models in my sandbox (no model downloads there), so the first eval run on your Mac gives the real number. If a full match is too slow for production, a GPU service is the next step, and I'll price it before anything is signed up for.

## Tests

```sh
cd artifacts/ml-server && python -m pytest tests
```

The end-to-end test renders a synthetic match (camera behind the baseline, real ball physics, serve toss, faults, volleys) and runs the full pipeline with stand-in detectors. It proves the logic; real accuracy comes from the labeled set.

## Footage review

New test-set videos dropped in the shared Google Drive folder get an automatic check: resolution, frame rate, HDR, compression, framing, camera movement, lighting, and whether the ball model can see the ball. You get a Mac notification and a verdict per video (Good, Usable with notes, Needs a re-record) with a drafted note to the friend, in `~/BallBoiTestSet/Review/Review.md`. The review never writes into the shared folder.

```sh
python -m intake check <video>                 # one file
bash scripts/mac/install-footage-review.sh     # hourly on this Mac (needs Google Drive for desktop and Docker)
bash scripts/mac/install-footage-review.sh --uninstall
```
