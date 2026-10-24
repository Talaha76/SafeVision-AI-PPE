# ============================================================
# SAFEVISION AI — ANALYTICS API
# ============================================================
#
# Provides dashboard analytics from PostgreSQL.
#
# Non-Compliance Rate:
#
# LIVE DETECTION
#   0 missing PPE =   0%
#   1 missing PPE =  25%
#   2 missing PPE =  50%
#   3 missing PPE =  75%
#   4 missing PPE = 100%
#
# DEMO FALLBACK
#   Each permanent demo image is treated as 75% non-compliant
#   because the demo image tracks one PPE category out of the
#   four required PPE categories.
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
# CONSTANTS
# ============================================================

CORE_PPE = (
    "hardhat",
    "vest",
    "mask",
    "gloves",
)


PPE_COUNT = len(
    CORE_PPE
)


# Each demo image represents one PPE category being tracked.
#
# Your desired interpretation:
#
# 1 of 4 accounted for
# 3 of 4 considered non-compliant
#
# 3 / 4 = 75%
DEMO_MISSING_PPE_COUNT = 3


# ============================================================
# HELPERS
# ============================================================

def normalize_violation_type(
    value: str,
) -> str:
    normalized = (
        value
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )

    if normalized.startswith(
        "missing_"
    ):
        normalized = normalized[
            len("missing_"):
        ]

    if normalized.startswith(
        "no_"
    ):
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
    if detected_at.tzinfo is None:
        return (
            detected_at.date()
        )

    return (
        detected_at
        .astimezone(
            timezone.utc
        )
        .date()
    )


# ============================================================
# REQUEST SCHEMAS
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


# ============================================================
# DASHBOARD SUMMARY
# ============================================================

@router.get("/summary")
def analytics_summary(
    db: Session = Depends(
        get_db
    ),
):
    """
    Return SafeVision dashboard summary.

    The existing response field:

        compliance_rate

    is preserved for frontend compatibility, but it represents:

        NON-COMPLIANCE RATE

    LIVE DETECTION
    ----------------
    Each tracked person observation is evaluated against:

        hardhat
        vest
        mask
        gloves

    Formula:

        missing PPE
        -----------
            4
        x 100

    DEMO DATA
    ---------
    When there are no live observations, every permanent demo
    image contributes 75% non-compliance.

    This keeps demo analytics populated while allowing actual
    live observations to completely take over the KPI during
    a live session.
    """

    result = dict(
        summary(db)
    )

    today = datetime.now(
        timezone.utc
    ).date()

    today_start = (
        datetime.combine(
            today,
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
    )


    # ========================================================
    # LIVE DETECTION NON-COMPLIANCE
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


    if live_rows:
        total_live_missing_slots = 0


        for observation in live_rows:
            missing_count = max(
                0,
                min(
                    int(
                        observation.missing_count
                        or 0
                    ),
                    PPE_COUNT,
                ),
            )


            total_live_missing_slots += (
                missing_count
            )


        total_live_slots = (
            len(
                live_rows
            )
            * PPE_COUNT
        )


        result[
            "compliance_rate"
        ] = round(
            (
                total_live_missing_slots
                / total_live_slots
            )
            * 100,
            1,
        )


    else:

        # ====================================================
        # DEMO FALLBACK
        # ====================================================
        #
        # Each demo image is treated as:
        #
        # 3 missing PPE / 4 required PPE
        #
        # = 75% non-compliant
        #
        # Five demo images therefore still average to 75%.
        # ====================================================

        demo_count = int(
            db.scalar(
                select(
                    func.count(
                        Incident.id
                    )
                )
                .where(
                    Incident.is_demo.is_(
                        True
                    )
                )
            )
            or 0
        )


        if demo_count <= 0:
            result[
                "compliance_rate"
            ] = None


        else:
            demo_missing_slots = (
                demo_count
                * DEMO_MISSING_PPE_COUNT
            )


            demo_total_slots = (
                demo_count
                * PPE_COUNT
            )


            result[
                "compliance_rate"
            ] = round(
                (
                    demo_missing_slots
                    / demo_total_slots
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


# ============================================================
# LIVE COMPLIANCE OBSERVATIONS
# ============================================================

@router.post(
    "/compliance-observations",
    status_code=201,
)
def create_compliance_observation(
    payload: ComplianceObservationCreate,

    db: Session = Depends(
        get_db
    ),
):
    normalized_missing = []


    for value in (
        payload.missing_ppe
    ):
        normalized = (
            normalize_violation_type(
                value
            )
        )


        if (
            normalized
            in CORE_PPE
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


    observation = (
        ComplianceObservation(
            camera_id=(
                payload.camera_id
            ),

            track_id=(
                payload.track_id
            ),

            is_compliant=(
                is_compliant
            ),

            missing_ppe=(
                normalized_missing
            ),

            missing_count=(
                len(
                    normalized_missing
                )
            ),
        )
    )


    db.add(
        observation
    )

    db.commit()

    db.refresh(
        observation
    )


    non_compliance_pct = round(
        (
            observation.missing_count
            / PPE_COUNT
        )
        * 100,
        1,
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

        "non_compliance_pct":
            non_compliance_pct,

        "observed_at":
            observation.observed_at,
    }


# ============================================================
# DUPLICATE ANALYTICS EVENTS
# ============================================================

@router.post(
    "/duplicate-events",
    status_code=201,
)
def create_duplicate_event(
    payload: DuplicateEventCreate,

    db: Session = Depends(
        get_db
    ),
):
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
        camera_id=(
            payload.camera_id
        ),

        track_id=(
            payload.track_id
        ),

        class_name=(
            payload.event_type
        ),

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


# ============================================================
# INCIDENT TREND
# ============================================================

@router.get("/trends")
def analytics_trends(
    days: int = Query(
        default=14,
        ge=1,
        le=365,
    ),

    db: Session = Depends(
        get_db
    ),
):
    return trend(
        db,
        days,
    )


# ============================================================
# VIOLATIONS
# ============================================================

@router.get("/violations")
def analytics_violations(
    db: Session = Depends(
        get_db
    ),
):
    rows = db.execute(
        select(
            Incident.violation_type,

            func.count(
                Incident.id
            ).label(
                "count"
            ),
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


# ============================================================
# SITES
# ============================================================

@router.get("/sites")
def analytics_sites(
    db: Session = Depends(
        get_db
    ),
):
    rows = db.execute(
        select(
            Site.id,

            Site.name,

            func.count(
                Incident.id
            ).label(
                "count"
            ),
        )
        .join(
            Camera,
            Camera.site_id
            == Site.id,
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
            "site_id":
                row.id,

            "site":
                row.name,

            "count":
                row.count,
        }

        for row in rows
    ]


# ============================================================
# DASHBOARD CHARTS
# ============================================================

@router.get(
    "/dashboard-charts"
)
def dashboard_charts(
    days: int = Query(
        default=7,
        ge=1,
        le=30,
    ),

    db: Session = Depends(
        get_db
    ),
):
    today = datetime.now(
        timezone.utc
    ).date()


    start_date = (
        today
        - timedelta(
            days=days - 1
        )
    )


    start_datetime = (
        datetime.combine(
            start_date,

            datetime.min.time(),

            tzinfo=timezone.utc,
        )
    )


    # ========================================================
    # INCIDENTS FROM LAST N DAYS
    # ========================================================

    recent_incidents = list(
        db.scalars(
            select(
                Incident
            )
            .where(
                Incident.detected_at
                >= start_datetime
            )
        ).all()
    )


    # ========================================================
    # WEEKLY PPE COUNTS
    # ========================================================

    ppe_counts = {
        item: 0

        for item in CORE_PPE
    }


    # ========================================================
    # DAILY PPE COUNTS
    # ========================================================

    daily_rows = []

    daily_index = {}


    for offset in range(
        days
    ):
        day = (
            start_date
            + timedelta(
                days=offset
            )
        )


        row = {
            "date":
                day.strftime(
                    "%a %d"
                ),

            "hardhat":
                0,

            "vest":
                0,

            "mask":
                0,

            "gloves":
                0,
        }


        daily_rows.append(
            row
        )


        daily_index[
            day
        ] = row


    for incident in recent_incidents:
        ppe = (
            normalize_violation_type(
                incident.violation_type
            )
        )


        if (
            ppe
            not in CORE_PPE
        ):
            continue


        ppe_counts[
            ppe
        ] += 1


        day = incident_date(
            incident.detected_at
        )


        if (
            day
            in daily_index
        ):
            daily_index[
                day
            ][
                ppe
            ] += 1


    weekly_by_ppe = [
        {
            "ppe":
                "Hardhat",

            "count":
                ppe_counts[
                    "hardhat"
                ],
        },

        {
            "ppe":
                "Vest",

            "count":
                ppe_counts[
                    "vest"
                ],
        },

        {
            "ppe":
                "Mask",

            "count":
                ppe_counts[
                    "mask"
                ],
        },

        {
            "ppe":
                "Gloves",

            "count":
                ppe_counts[
                    "gloves"
                ],
        },
    ]


    # ========================================================
    # STATUS DISTRIBUTION
    # ========================================================

    status_rows = db.execute(
        select(
            Incident.status,

            func.count(
                Incident.id
            ).label(
                "count"
            ),
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
        "open":
            0,

        "reviewing":
            0,

        "resolved":
            0,

        "dismissed":
            0,
    }


    for row in status_rows:
        status = (
            row.status
            or "open"
        ).lower()


        if (
            status
            in status_counts
        ):
            status_counts[
                status
            ] = row.count


    status_distribution = [
        {
            "status":
                "Open",

            "count":
                status_counts[
                    "open"
                ],
        },

        {
            "status":
                "Reviewing",

            "count":
                status_counts[
                    "reviewing"
                ],
        },

        {
            "status":
                "Resolved",

            "count":
                status_counts[
                    "resolved"
                ],
        },

        {
            "status":
                "Dismissed",

            "count":
                status_counts[
                    "dismissed"
                ],
        },
    ]


    # ========================================================
    # SEVERITY DISTRIBUTION
    # ========================================================

    severity_rows = db.execute(
        select(
            Incident.severity,

            func.count(
                Incident.id
            ).label(
                "count"
            ),
        )
        .group_by(
            Incident.severity
        )
    ).all()


    severity_counts = {
        "high":
            0,

        "medium":
            0,

        "low":
            0,
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
            "severity":
                "High",

            "count":
                severity_counts[
                    "high"
                ],
        },

        {
            "severity":
                "Medium",

            "count":
                severity_counts[
                    "medium"
                ],
        },

        {
            "severity":
                "Low",

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