from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Camera, Incident, IncidentEvidence
from app.db.session import get_db
from app.schemas.incidents import IncidentCreate, IncidentPatch, IncidentRead
from app.services.incident_service import create_incident_if_new


router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("", response_model=list[IncidentRead])
def list_incidents(
    status: str | None = None,
    severity: str | None = None,
    site: int | None = None,
    camera: int | None = None,
    violation_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = select(Incident)

    if site is not None:
        stmt = stmt.join(Camera).where(Camera.site_id == site)

    if camera is not None:
        stmt = stmt.where(Incident.camera_id == camera)

    if status:
        stmt = stmt.where(Incident.status == status)

    if severity:
        stmt = stmt.where(Incident.severity == severity)

    if violation_type:
        stmt = stmt.where(Incident.violation_type == violation_type)

    if start:
        stmt = stmt.where(Incident.detected_at >= start)

    if end:
        stmt = stmt.where(Incident.detected_at <= end)

    return list(
        db.scalars(
            stmt.order_by(Incident.detected_at.desc()).limit(limit)
        ).all()
    )


@router.get("/{incident_id}", response_model=IncidentRead)
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
):
    incident = db.get(Incident, incident_id)

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return incident


@router.get("/{incident_id}/evidence")
def get_incident_evidence(
    incident_id: int,
    db: Session = Depends(get_db),
):
    # First make sure the incident itself exists.
    incident = db.get(Incident, incident_id)

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    # Find the newest evidence snapshot associated with the incident.
    stmt = (
        select(IncidentEvidence)
        .where(IncidentEvidence.incident_id == incident_id)
        .order_by(
            IncidentEvidence.created_at.desc(),
            IncidentEvidence.id.desc(),
        )
        .limit(1)
    )

    evidence = db.scalar(stmt)

    if evidence is None:
        raise HTTPException(
            status_code=404,
            detail="Evidence not available for this incident",
        )

    # Return the raw JPEG/PNG bytes directly to the browser.
    return Response(
        content=evidence.image_data,
        media_type=evidence.mime_type or "image/jpeg",
    )


@router.post("", response_model=IncidentRead, status_code=201)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
):
    incident, _created = create_incident_if_new(db, payload)
    return incident


@router.patch("/{incident_id}", response_model=IncidentRead)
def update_incident(
    incident_id: int,
    payload: IncidentPatch,
    db: Session = Depends(get_db),
):
    incident = db.get(Incident, incident_id)

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    data = payload.model_dump(exclude_unset=True)

    if (
        "status" in data
        and data["status"] == "resolved"
        and incident.status != "resolved"
    ):
        incident.resolved_at = datetime.now(timezone.utc)

    if "status" in data and data["status"] != "resolved":
        incident.resolved_at = None

    for key, value in data.items():
        setattr(incident, key, value)

    db.commit()
    db.refresh(incident)

    return incident