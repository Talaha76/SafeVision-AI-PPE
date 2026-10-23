# ============================================================
# SAFEVISION AI — MODEL METRICS IMPORT
# ============================================================
#
# Imports model evaluation metrics from a JSON file and
# stores them in PostgreSQL for dashboard reporting.
#
# ============================================================

import argparse
import json
from pathlib import Path
from app.db.models import ModelRun
from app.db.session import SessionLocal


def main(path: str, version: str, source: str) -> None:
    data = json.loads(Path(path).read_text())
    db = SessionLocal()
    try:
        row = ModelRun(
            model_version=version,
            source=source,
            avg_latency_ms=data.get("avg_inference_latency_ms"),
            fps=data.get("fps"),
            precision=data.get("precision"),
            recall=data.get("recall"),
            f1=data.get("f1"),
            map50=data.get("map50"),
            map50_95=data.get("map50_95"),
        )
        db.add(row)
        db.commit()
        print(f"Imported model_run id={row.id}")
    finally:
        db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default="../ml/evaluation/results/latest.json")
    p.add_argument("--version", required=True)
    p.add_argument("--source", required=True)
    a = p.parse_args()
    main(a.path, a.version, a.source)
