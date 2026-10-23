from datetime import (
    datetime,
    timedelta,
    timezone,
)

from fastapi import (
    APIRouter,
    Depends,
    Query,
)

from sqlalchemy import (
    func,
    select,
)

from sqlalchemy.orm import Session

from app.db.models import (
    Camera,
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

@router.get("/summary")
def analytics_summary(
    db: Session = Depends(get_db),
):
    return summary(db)


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
