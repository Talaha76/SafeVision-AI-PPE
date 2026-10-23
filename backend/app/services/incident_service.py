# ============================================================
# SAFEVISION AI — INCIDENT SERVICE
# ============================================================
#
# Creates incidents and prevents duplicate PPE violations
# within the configured cooldown period.
#
# ============================================================

from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import Incident
from app.schemas.incidents import IncidentCreate
from app.core.config import settings


def create_incident_if_new(db: Session, payload: IncidentCreate) -> tuple[Incident, bool]:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.incident_cooldown_seconds)
    existing = db.scalar(
        select(Incident)
        .where(
            Incident.camera_id == payload.camera_id,
            Incident.track_id == payload.track_id,
            Incident.violation_type == payload.violation_type,
            Incident.detected_at >= cutoff,
        )
        .order_by(Incident.detected_at.desc())
    )
    if existing:
        return existing, False

    incident = Incident(**payload.model_dump())
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return incident, True
