"""
Exports WASB's HRNet ball detector (tennis weights) to ONNX, then checks the
ONNX model matches PyTorch on a random input.

    python scripts/export_wasb_onnx.py --wasb-src WASB-SBDT/src \
        --checkpoint wasb_tennis_best.pth.tar --out models/wasb_tennis.onnx

Input:  (1, 9, 288, 512) float32, three RGB frames, ImageNet-normalized, stacked.
Output: (1, 3, 288, 512) heatmap logits, one per input frame.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wasb-src", type=Path, required=True, help="the repo's src/ folder")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    import torch
    from omegaconf import OmegaConf   # WASB's model code reads its config as attributes (cfg.MODEL.EXTRA)

    spec = importlib.util.spec_from_file_location("wasb_hrnet", args.wasb_src / "models" / "hrnet.py")
    hrnet = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hrnet)

    cfg = OmegaConf.load(args.wasb_src / "configs" / "model" / "wasb.yaml")
    model = hrnet.HRNet(cfg)
    # Tensors-only loading: a downloaded pickle can't run code here.
    try:
        checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    except Exception as exc:
        sys.exit(f"Checkpoint isn't plain weights, refusing to unpickle it: {exc}")
    state = checkpoint.get("model_state_dict", checkpoint)
    state = {k.removeprefix("module."): v for k, v in state.items()}
    model.load_state_dict(state, strict=True)
    model.eval()

    class Heatmaps(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, x):
            return self.inner(x)[0]

    wrapped = Heatmaps(model).eval()
    example = torch.randn(1, 9, 288, 512)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(wrapped, example, str(args.out), input_names=["frames"], output_names=["heatmaps"],
                      opset_version=17, dynamo=False)

    import onnxruntime as ort

    with torch.no_grad():
        expected = wrapped(example).numpy()
    got = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"]).run(None, {"frames": example.numpy()})[0]
    diff = float(np.abs(expected - got).max())
    print(f"Exported {args.out} ({got.shape}); max difference from PyTorch {diff:.2e}")
    if diff > 1e-3:
        sys.exit("ONNX output doesn't match PyTorch; not using this export.")


if __name__ == "__main__":
    main()
