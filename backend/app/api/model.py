# ============================================================
# SAFEVISION AI — MODEL API
# ============================================================
#
# Returns the latest stored model evaluation metrics,
# including precision, recall, F1, mAP, latency, and FPS.
#
# Route:
# GET /api/model/performance
#
# ============================================================

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import ModelRun
from app.db.session import get_db

router = APIRouter(prefix="/model", tags=["model"])


@router.get("/performance")
def latest_model_performance(db: Session = Depends(get_db)):
    run = db.scalar(select(ModelRun).order_by(ModelRun.created_at.desc()).limit(1))
    if run is None:
        return {"status": "not_evaluated"}
    return {
        "model_version": run.model_version,
        "source": run.source,
        "precision": run.precision,
        "recall": run.recall,
        "f1": run.f1,
        "map50": run.map50,
        "map50_95": run.map50_95,
        "avg_latency_ms": run.avg_latency_ms,
        "fps": run.fps,
        "created_at": run.created_at,
    }
