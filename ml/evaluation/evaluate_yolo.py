# ============================================================
# SAFEVISION AI — YOLO MODEL EVALUATION
# ============================================================
#
# Evaluates a YOLO PPE model on a validation dataset and
# saves precision, recall, F1, mAP, latency, and FPS metrics.
#
# ============================================================

import argparse
import json
from pathlib import Path
from ultralytics import YOLO


def main(weights: str, data_yaml: str, out: str) -> None:
    model = YOLO(weights)
    metrics = model.val(data=data_yaml, plots=True)
    precision = float(metrics.box.mp)
    recall = float(metrics.box.mr)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    latency_ms = float(metrics.speed.get("inference", 0.0))
    result = {
        "weights": weights,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "avg_inference_latency_ms": latency_ms,
        "fps": (1000.0 / latency_ms) if latency_ms else None,
        "note": "Confusion-matrix plots are emitted by Ultralytics when plots=True.",
    }
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--data", required=True, help="YOLO dataset YAML")
    p.add_argument("--out", default="ml/evaluation/results/latest.json")
    a = p.parse_args()
    main(a.weights, a.data, a.out)
