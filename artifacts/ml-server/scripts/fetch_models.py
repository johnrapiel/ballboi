"""
Downloads and prepares the analysis models into one folder. Run by the Docker
build (see Dockerfile); runs anywhere with internet and the packages below.

    python scripts/fetch_models.py --out models

Models (all run on CPU through ONNX Runtime):
  wasb_tennis.onnx       WASB ball detector, tennis weights. Code and weights: MIT,
                         NTT Communications (github.com/nttcom/WASB-SBDT).
                         Exported here from the PyTorch checkpoint.
  yolox_m_humanart.onnx  YOLOX-m person detector (Apache-2.0), MMDeploy build from OpenMMLab.
  rtmpose_m_body7.onnx   RTMPose-m body keypoints (Apache-2.0), MMDeploy build from OpenMMLab.

Needs: torch (CPU), omegaconf, gdown, onnxruntime, git. Writes MANIFEST.json with
each file's SHA-256 and source, so a build can be checked against an earlier one.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

WASB_REPO = "https://github.com/nttcom/WASB-SBDT"
WASB_COMMIT = "923462cacdeb3353b84ddebdedb3f4b7a8553b0f"
WASB_TENNIS_DRIVE_ID = "14AeyIOCQ2UaQmbZLNQJa1H_eSwxUXk7z"   # wasb_tennis_best.pth.tar, from the repo's MODEL_ZOO.md

OPENMMLAB = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
ZIPPED = {
    "yolox_m_humanart.onnx": OPENMMLAB + "yolox_m_8xb8-300e_humanart-c2c7a14a.zip",
    "rtmpose_m_body7.onnx": OPENMMLAB + "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_zipped_onnx(url: str, out: Path) -> None:
    print(f"Downloading {url}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as resp:
        data = resp.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        onnx_names = [n for n in z.namelist() if n.endswith(".onnx")]
        if len(onnx_names) != 1:
            sys.exit(f"Expected one .onnx file in {url}, found {onnx_names}")
        out.write_bytes(z.read(onnx_names[0]))


def build_wasb(out: Path, work: Path) -> dict:
    import gdown

    src = work / "WASB-SBDT"
    subprocess.run(["git", "clone", "--quiet", WASB_REPO, str(src)], check=True)
    subprocess.run(["git", "-C", str(src), "checkout", "--quiet", WASB_COMMIT], check=True)
    ckpt = work / "wasb_tennis_best.pth.tar"
    gdown.download(id=WASB_TENNIS_DRIVE_ID, output=str(ckpt), quiet=False)
    if not ckpt.is_file() or ckpt.stat().st_size < 100_000:
        sys.exit("WASB tennis weights didn't download. Check the Google Drive link in WASB's MODEL_ZOO.md.")
    subprocess.run([sys.executable, str(Path(__file__).with_name("export_wasb_onnx.py")),
                    "--wasb-src", str(src / "src"), "--checkpoint", str(ckpt), "--out", str(out)], check=True)
    return {"checkpointSha256": sha256(ckpt), "repoCommit": WASB_COMMIT}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}

    for name, url in ZIPPED.items():
        target = args.out / name
        fetch_zipped_onnx(url, target)
        manifest[name] = {"source": url, "license": "Apache-2.0", "sha256": sha256(target)}

    with tempfile.TemporaryDirectory() as tmp:
        extra = build_wasb(args.out / "wasb_tennis.onnx", Path(tmp))
    manifest["wasb_tennis.onnx"] = {"source": f"{WASB_REPO} (tennis weights, MODEL_ZOO.md)", "license": "MIT",
                                    "sha256": sha256(args.out / "wasb_tennis.onnx"), **extra}

    (args.out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
