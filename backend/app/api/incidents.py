# ============================================================
# SAFEVISION AI — INCIDENTS API
# ============================================================
#
# Manages incident records and evidence in PostgreSQL.
# Supports filtering, counting, retrieving, creating,
# updating, and viewing incident evidence.
#
# Routes are available under:
# /api/incidents
#
# ============================================================

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Camera, Incident, IncidentEvidence
from app.db.session import get_db
from app.schemas.incidents import (
    IncidentCreate,
    IncidentPatch,
    IncidentRead,
)
from app.services.incident_service import (
    create_incident_if_new,
)


router = APIRouter(
    prefix="/incidents",
    tags=["incidents"],
)


def build_incident_query(
    *,
    status: str | None = None,
    severity: str | None = None,
    site: int | None = None,
    camera: int | None = None,
    violation_type: str | None = None,
    search: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
):
    stmt = select(Incident)

    if site is not None:
        stmt = (
            stmt
            .join(Camera)
            .where(
                Camera.site_id == site
            )
        )

    if camera is not None:
        stmt = stmt.where(
            Incident.camera_id == camera
        )

    if status:
        stmt = stmt.where(
            Incident.status == status
        )

    if severity:
        stmt = stmt.where(
            Incident.severity == severity
        )

    if violation_type:
        stmt = stmt.where(
            Incident.violation_type
            == violation_type
        )

    if start:
        stmt = stmt.where(
            Incident.detected_at >= start
        )

    if end:
        stmt = stmt.where(
            Incident.detected_at <= end
        )

    if search:
        term = search.strip()

        if term:
            text_pattern = f"%{term}%"

            conditions = [
                Incident.violation_type.ilike(
                    text_pattern
                ),
                Incident.status.ilike(
                    text_pattern
                ),
                Incident.severity.ilike(
                    text_pattern
                ),
            ]

            numeric_term = (
                term.removeprefix("#")
            )

            if numeric_term.isdigit():
                number = int(
                    numeric_term
                )

                conditions.extend([
                    Incident.id == number,
                    Incident.track_id == number,
                    Incident.camera_id == number,
                ])

            stmt = stmt.where(
                or_(*conditions)
            )

    return stmt


@router.get(
    "",
    response_model=list[IncidentRead],
)
def list_incidents(
    status: str | None = None,
    severity: str | None = None,
    site: int | None = None,
    camera: int | None = None,
    violation_type: str | None = None,
    search: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    offset: int = Query(
        default=0,
        ge=0,
    ),
    limit: int = Query(
        default=100,
        ge=1,
        le=500,
    ),
    db: Session = Depends(get_db),
):
    if (
        start is not None
        and end is not None
        and end < start
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "End date must be after "
                "start date."
            ),
        )

    stmt = build_incident_query(
        status=status,
        severity=severity,
        site=site,
        camera=camera,
        violation_type=violation_type,
        search=search,
        start=start,
        end=end,
    )

    return list(
        db.scalars(
            stmt
            .order_by(
                Incident.detected_at.desc(),
                Incident.id.desc(),
            )
            .offset(offset)
            .limit(limit)
        ).all()
    )


@router.get(
    "/count",
)
def count_incidents(
    status: str | None = None,
    severity: str | None = None,
    site: int | None = None,
    camera: int | None = None,
    violation_type: str | None = None,
    search: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
):
    if (
        start is not None
        and end is not None
        and end < start
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "End date must be after "
                "start date."
            ),
        )

    stmt = build_incident_query(
        status=status,
        severity=severity,
        site=site,
        camera=camera,
        violation_type=violation_type,
        search=search,
        start=start,
        end=end,
    )

    count_stmt = (
        select(
            func.count()
        )
        .select_from(
            stmt
            .order_by(None)
            .subquery()
        )
    )

    count = db.scalar(
        count_stmt
    )

    return {
        "count": int(
            count or 0
        ),
    }


@router.get(
    "/{incident_id}",
    response_model=IncidentRead,
)
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
):
    incident = db.get(
        Incident,
        incident_id,
    )

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return incident


@router.get(
    "/{incident_id}/evidence",
)
def get_incident_evidence(
    incident_id: int,
    db: Session = Depends(get_db),
):
    incident = db.get(
        Incident,
        incident_id,
    )

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    stmt = (
        select(IncidentEvidence)
        .where(
            IncidentEvidence.incident_id
            == incident_id
        )
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
            detail=(
                "Evidence not available "
                "for this incident"
            ),
        )

    return Response(
        content=evidence.image_data,
        media_type=(
            evidence.mime_type
            or "image/jpeg"
        ),
    )


@router.post(
    "",
    response_model=IncidentRead,
    status_code=201,
)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
):
    incident, _created = (
        create_incident_if_new(
            db,
            payload,
        )
    )

    return incident


@router.patch(
    "/{incident_id}",
    response_model=IncidentRead,
)
def update_incident(
    incident_id: int,
    payload: IncidentPatch,
    db: Session = Depends(get_db),
):
    incident = db.get(
        Incident,
        incident_id,
    )

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    data = payload.model_dump(
        exclude_unset=True,
    )

    if (
        "status" in data
        and data["status"] == "resolved"
        and incident.status != "resolved"
    ):
        incident.resolved_at = (
            datetime.now(
                timezone.utc
            )
        )

    if (
        "status" in data
        and data["status"] != "resolved"
    ):
        incident.resolved_at = None

    for key, value in data.items():
        setattr(
            incident,
            key,
            value,
        )

    db.commit()
    db.refresh(incident)

    return incident
