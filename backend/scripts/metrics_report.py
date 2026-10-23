# ============================================================
# SAFEVISION AI — METRICS REPORT
# ============================================================
#
# Prints measured database and model performance metrics
# for validation, reporting, and portfolio documentation.
#
# ============================================================

"""Print database-backed portfolio metrics. Run only after collecting real data."""
from sqlalchemy import func, select
from app.db.models import ComplianceObservation, DetectionEvent, Incident, ModelRun
from app.db.session import SessionLocal
from app.services.analytics_service import summary


def main() -> None:
    db = SessionLocal()
    try:
        dashboard = summary(db)
        detection_events = db.scalar(select(func.count(DetectionEvent.id))) or 0
        observations = db.scalar(select(func.count(ComplianceObservation.id))) or 0
        latest_model = db.scalar(select(ModelRun).order_by(ModelRun.created_at.desc()).limit(1))

        print("SafeVision measured metrics")
        print("===========================")
        print(f"Detection events: {detection_events}")
        print(f"Compliance observations: {observations}")
        print(f"Unique incidents: {dashboard['unique_incidents']}")
        print(f"Raw violation observations: {dashboard['raw_violation_observations']}")
        print(f"Duplicate reduction: {dashboard['duplicate_reduction_pct']}%")
        print(f"Compliance rate: {dashboard['compliance_rate']}%")
        print(f"Open incidents: {dashboard['open_incidents']}")
        if latest_model:
            print("\nLatest model run")
            print(f"Version: {latest_model.model_version}")
            print(f"Precision: {latest_model.precision}")
            print(f"Recall: {latest_model.recall}")
            print(f"F1: {latest_model.f1}")
            print(f"mAP50: {latest_model.map50}")
            print(f"mAP50-95: {latest_model.map50_95}")
            print(f"Latency ms: {latest_model.avg_latency_ms}")
            print(f"FPS: {latest_model.fps}")
        else:
            print("\nNo model evaluation has been imported yet.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
