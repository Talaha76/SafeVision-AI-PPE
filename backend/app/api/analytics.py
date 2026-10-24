# ============================================================
# SAFEVISION AI — ANALYTICS API
# ============================================================
#
# Provides dashboard analytics from PostgreSQL, including
# summaries, trends, PPE violations, site counts, incident
# statuses, severity distribution, and chart data.
#
# Routes are available under:
# /api/analytics
#
# ============================================================

from datetime import (
    datetime,
    timedelta,
    timezone,
)

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)

from pydantic import (
    BaseModel,
    Field,
)

from sqlalchemy import (
    func,
    select,
)

from sqlalchemy.orm import Session

from app.db.models import (
    Camera,
    ComplianceObservation,
    DetectionEvent,
    Incident,
    Site,
)

from app.db.session import get_db

from app.services.analytics_service import (
    summary,
    trend,
)


router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
)


# ============================================================
# HELPERS
# ============================================================

CORE_PPE = (
    "hardhat",
    "vest",
    "mask",
    "gloves",
)


def normalize_violation_type(
    value: str,
) -> str:
    """
    Convert different incident naming styles into
    the four PPE names used by dashboard charts.

    Examples:
    hardhat
        -> hardhat
    NO-Hardhat
        -> hardhat
    missing_hardhat
        -> hardhat
    NO-Safety Vest
        -> vest
    """

    normalized = (
        value
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )

    if normalized.startswith("missing_"):
        normalized = normalized[
            len("missing_"):
        ]

    if normalized.startswith("no_"):
        normalized = normalized[
            len("no_"):
        ]

    if normalized in {
        "safety_vest",
        "vest",
    }:
        return "vest"

    return normalized


def incident_date(
    detected_at: datetime,
):
    """
    Safely return the incident's UTC date.

    PostgreSQL normally returns timezone-aware
    timestamps, but this also handles naive
    timestamps during local/testing scenarios.
    """

    if detected_at.tzinfo is None:
        return detected_at.date()

    return (
        detected_at
        .astimezone(timezone.utc)
        .date()
    )


# ============================================================
# EXISTING ANALYTICS
# ============================================================

class ComplianceObservationCreate(
    BaseModel
):
    camera_id: int = Field(
        ge=1,
    )

    track_id: int = Field(
        ge=1,
    )

    is_compliant: bool

    missing_ppe: list[str]

    missing_count: int = Field(
        ge=0,
    )


class DuplicateEventCreate(
    BaseModel
):
    camera_id: int = Field(
        ge=1,
    )

    track_id: int = Field(
        ge=1,
    )

    event_type: str


DUPLICATE_EVENT_TYPES = {
    "alert_candidate",
    "alert_created",
    "alert_suppressed",
}


@router.get("/summary")
def analytics_summary(
    db: Session = Depends(get_db),
):
    """
    Return the SafeVision dashboard summary.

    The existing compliance_rate JSON key is kept for frontend
    compatibility, but it now represents NON-COMPLIANCE RATE.

    SafeVision evaluates four required PPE categories:

    1. Hardhat
    2. Safety Vest
    3. Mask
    4. Gloves

    Each observation contributes:

    0 missing PPE ->   0% non-compliant
    1 missing PPE ->  25% non-compliant
    2 missing PPE ->  50% non-compliant
    3 missing PPE ->  75% non-compliant
    4 missing PPE -> 100% non-compliant

    Dashboard Non-Compliance Rate:

        total missing PPE slots
        ----------------------- x 100
        total observations * 4

    Permanent demo incidents each count as one observation.
    Their missing_ppe list determines how many of the four PPE
    requirements are missing.

    Live Detection observations use their stored missing_count.
    """

    result = dict(
        summary(db)
    )

    today = datetime.now(
        timezone.utc
    ).date()

    today_start = datetime.combine(
        today,
        datetime.min.time(),
        tzinfo=timezone.utc,
    )

    # ========================================================
    # LIVE DETECTION OBSERVATIONS
    # ========================================================

    live_rows = list(
        db.scalars(
            select(
                ComplianceObservation
            )
            .where(
                ComplianceObservation.observed_at
                >= today_start
            )
        ).all()
    )

    live_observation_count = len(
        live_rows
    )

    live_missing_slots = 0

    for observation in live_rows:
        # Clamp every observation between 0 and 4 missing PPE.
        missing_count = max(
            0,
            min(
                int(
                    observation.missing_count
                    or 0
                ),
                len(
                    CORE_PPE
                ),
            ),
        )

        live_missing_slots += (
            missing_count
        )

    # ========================================================
    # PERMANENT DEMO OBSERVATIONS
    # ========================================================

    demo_rows = list(
        db.scalars(
            select(
                Incident
            )
            .where(
                Incident.is_demo.is_(
                    True
                )
            )
        ).all()
    )

    demo_observation_count = len(
        demo_rows
    )

    demo_missing_slots = 0

    for incident in demo_rows:
        normalized_missing = []

        for value in (
            incident.missing_ppe
            or []
        ):
            normalized = (
                normalize_violation_type(
                    value
                )
            )

            if (
                normalized in CORE_PPE
                and normalized
                not in normalized_missing
            ):
                normalized_missing.append(
                    normalized
                )

        demo_missing_slots += min(
            len(
                normalized_missing
            ),
            len(
                CORE_PPE
            ),
        )

    # ========================================================
    # NON-COMPLIANCE RATE
    # ========================================================

    total_observations = (
        live_observation_count
        + demo_observation_count
    )

    total_missing_slots = (
        live_missing_slots
        + demo_missing_slots
    )

    total_possible_slots = (
        total_observations
        * len(
            CORE_PPE
        )
    )

    if total_possible_slots <= 0:
        result[
            "compliance_rate"
        ] = None

    else:
        result[
            "compliance_rate"
        ] = round(
            (
                total_missing_slots
                / total_possible_slots
            )
            * 100,
            1,
        )

    # ========================================================
    # DUPLICATE REDUCTION
    # ========================================================

    created_alerts = int(
        db.scalar(
            select(
                func.count(
                    DetectionEvent.id
                )
            )
            .where(
                DetectionEvent.detected_at
                >= today_start,
                DetectionEvent.class_name
                == "alert_created",
            )
        )
        or 0
    )

    suppressed_alerts = int(
        db.scalar(
            select(
                func.count(
                    DetectionEvent.id
                )
            )
            .where(
                DetectionEvent.detected_at
                >= today_start,
                DetectionEvent.class_name
                == "alert_suppressed",
            )
        )
        or 0
    )

    duplicate_decisions = (
        created_alerts
        + suppressed_alerts
    )

    if duplicate_decisions <= 0:
        result[
            "duplicate_reduction_pct"
        ] = None

    else:
        result[
            "duplicate_reduction_pct"
        ] = round(
            (
                suppressed_alerts
                / duplicate_decisions
            )
            * 100,
            1,
        )

    return result


@router.post(
    "/compliance-observations",
    status_code=201,
)
def create_compliance_observation(
    payload: ComplianceObservationCreate,
    db: Session = Depends(get_db),
):
    """
    Store one lightweight person-observation snapshot from
    browser Live Detection.

    Live Detection throttles these writes, so this endpoint is
    not called for every inference frame.
    """

    normalized_missing = []

    for value in payload.missing_ppe:
        normalized = normalize_violation_type(
            value
        )

        if (
            normalized in CORE_PPE
            and normalized
            not in normalized_missing
        ):
            normalized_missing.append(
                normalized
            )

    is_compliant = (
        len(
            normalized_missing
        )
        == 0
    )

    observation = ComplianceObservation(
        camera_id=payload.camera_id,
        track_id=payload.track_id,
        is_compliant=is_compliant,
        missing_ppe=normalized_missing,
        missing_count=len(
            normalized_missing
        ),
    )

    db.add(
        observation
    )

    db.commit()

    db.refresh(
        observation
    )

    return {
        "id":
            observation.id,

        "camera_id":
            observation.camera_id,

        "track_id":
            observation.track_id,

        "is_compliant":
            observation.is_compliant,

        "missing_ppe":
            observation.missing_ppe,

        "missing_count":
            observation.missing_count,

        "observed_at":
            observation.observed_at,
    }


@router.post(
    "/duplicate-events",
    status_code=201,
)
def create_duplicate_event(
    payload: DuplicateEventCreate,
    db: Session = Depends(get_db),
):
    """
    Record one lightweight duplicate-alert metric from browser
    Live Detection.

    event_type values:
    - alert_candidate
    - alert_created
    - alert_suppressed
    """

    if (
        payload.event_type
        not in DUPLICATE_EVENT_TYPES
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Expected alert_candidate, "
                "alert_created, or "
                "alert_suppressed."
            ),
        )

    camera = db.get(
        Camera,
        payload.camera_id,
    )

    if camera is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Camera "
                f"{payload.camera_id} "
                "does not exist."
            ),
        )

    event = DetectionEvent(
        camera_id=payload.camera_id,
        track_id=payload.track_id,
        class_name=payload.event_type,

        # This table requires a confidence value.
        # Duplicate-event rows are categorical metrics,
        # not model detections, so 1.0 means the event
        # definitely occurred.
        confidence=1.0,
    )

    db.add(
        event
    )

    db.commit()

    db.refresh(
        event
    )

    return {
        "id":
            event.id,

        "camera_id":
            event.camera_id,

        "track_id":
            event.track_id,

        "event_type":
            event.class_name,

        "detected_at":
            event.detected_at,
    }


@router.get("/trends")
def analytics_trends(
    days: int = Query(
        default=14,
        ge=1,
        le=365,
    ),
    db: Session = Depends(get_db),
):
    return trend(
        db,
        days,
    )


@router.get("/violations")
def analytics_violations(
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(
            Incident.violation_type,
            func.count(
                Incident.id
            ).label("count"),
        )
        .group_by(
            Incident.violation_type
        )
        .order_by(
            func.count(
                Incident.id
            ).desc()
        )
    ).all()

    return [
        {
            "violation_type":
                row.violation_type,
            "count":
                row.count,
        }
        for row in rows
    ]


@router.get("/sites")
def analytics_sites(
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(
            Site.id,
            Site.name,
            func.count(
                Incident.id
            ).label("count"),
        )
        .join(
            Camera,
            Camera.site_id == Site.id,
        )
        .outerjoin(
            Incident,
            Incident.camera_id
            == Camera.id,
        )
        .group_by(
            Site.id,
            Site.name,
        )
        .order_by(
            func.count(
                Incident.id
            ).desc()
        )
    ).all()

    return [
        {
            "site_id": row.id,
            "site": row.name,
            "count": row.count,
        }
        for row in rows
    ]


# ============================================================
# DASHBOARD CHARTS
# ============================================================

@router.get("/dashboard-charts")
def dashboard_charts(
    days: int = Query(
        default=7,
        ge=1,
        le=30,
    ),
    db: Session = Depends(get_db),
):
    """
    Return data for:
    1. Violations by PPE type
    2. PPE violations by day
    3. Incident status distribution
    4. Severity distribution
    """

    today = datetime.now(
        timezone.utc
    ).date()

    start_date = (
        today
        - timedelta(
            days=days - 1
        )
    )

    start_datetime = datetime.combine(
        start_date,
        datetime.min.time(),
        tzinfo=timezone.utc,
    )


    # ========================================================
    # INCIDENTS FROM LAST N DAYS
    # ========================================================

    recent_incidents = list(
        db.scalars(
            select(Incident)
            .where(
                Incident.detected_at
                >= start_datetime
            )
        ).all()
    )


    # ========================================================
    # 1. WEEKLY VIOLATIONS BY PPE
    # ========================================================

    ppe_counts = {
        item: 0
        for item in CORE_PPE
    }


    # ========================================================
    # 2. DAILY STACKED PPE DATA
    # ========================================================

    daily_rows = []

    daily_index = {}


    for offset in range(days):

        day = (
            start_date
            + timedelta(
                days=offset
            )
        )

        row = {
            "date": day.strftime(
                "%a %d"
            ),

            "hardhat": 0,
            "vest": 0,
            "mask": 0,
            "gloves": 0,
        }

        daily_rows.append(row)

        daily_index[
            day
        ] = row


    # Count recent incidents.
    for incident in recent_incidents:

        ppe = (
            normalize_violation_type(
                incident.violation_type
            )
        )

        if ppe not in CORE_PPE:
            continue

        ppe_counts[ppe] += 1

        day = incident_date(
            incident.detected_at
        )

        if day in daily_index:
            daily_index[
                day
            ][ppe] += 1


    weekly_by_ppe = [
        {
            "ppe": "Hardhat",
            "count":
                ppe_counts[
                    "hardhat"
                ],
        },
        {
            "ppe": "Vest",
            "count":
                ppe_counts[
                    "vest"
                ],
        },
        {
            "ppe": "Mask",
            "count":
                ppe_counts[
                    "mask"
                ],
        },
        {
            "ppe": "Gloves",
            "count":
                ppe_counts[
                    "gloves"
                ],
        },
    ]


    # ========================================================
    # 3. INCIDENT STATUS DISTRIBUTION
    # ========================================================

    status_rows = db.execute(
        select(
            Incident.status,
            func.count(
                Incident.id
            ).label("count"),
        )
        .where(
            Incident.status.in_(
                [
                    "open",
                    "reviewing",
                    "resolved",
                    "dismissed",
                ]
            )
        )
        .group_by(
            Incident.status
        )
    ).all()


    status_counts = {
        "open": 0,
        "reviewing": 0,
        "resolved": 0,
        "dismissed": 0,
    }


    for row in status_rows:

        status = (
            row.status
            or "open"
        ).lower()

        if status in status_counts:
            status_counts[
                status
            ] = row.count


    status_distribution = [
        {
            "status": "Open",
            "count":
                status_counts[
                    "open"
                ],
        },
        {
            "status": "Reviewing",
            "count":
                status_counts[
                    "reviewing"
                ],
        },
        {
            "status": "Resolved",
            "count":
                status_counts[
                    "resolved"
                ],
        },
        {
            "status": "Dismissed",
            "count":
                status_counts[
                    "dismissed"
                ],
        },
    ]


    # ========================================================
    # 4. SEVERITY DISTRIBUTION
    # ========================================================

    severity_rows = db.execute(
        select(
            Incident.severity,
            func.count(
                Incident.id
            ).label("count"),
        )
        .group_by(
            Incident.severity
        )
    ).all()


    severity_counts = {
        "high": 0,
        "medium": 0,
        "low": 0,
    }


    for row in severity_rows:

        severity = (
            row.severity
            or "low"
        ).lower()

        if (
            severity
            in severity_counts
        ):
            severity_counts[
                severity
            ] = row.count


    severity_distribution = [
        {
            "severity": "High",
            "count":
                severity_counts[
                    "high"
                ],
        },
        {
            "severity": "Medium",
            "count":
                severity_counts[
                    "medium"
                ],
        },
        {
            "severity": "Low",
            "count":
                severity_counts[
                    "low"
                ],
        },
    ]


    return {
        "weekly_by_ppe":
            weekly_by_ppe,

        "daily_by_ppe":
            daily_rows,

        "status_distribution":
            status_distribution,

        "severity_distribution":
            severity_distribution,
    }
