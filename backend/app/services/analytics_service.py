# ============================================================
# SAFEVISION AI — ANALYTICS SERVICE
# ============================================================
#
# Calculates dashboard statistics such as incident totals,
# compliance rate, top violations, risk locations, resolution
# time, duplicate reduction, and incident trends.
#
# ============================================================

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Camera,
    ComplianceObservation,
    Incident,
    Site,
)


# ============================================================
# PPE NORMALIZATION
# ============================================================

def normalize_violation_type(
    value: str | None,
) -> str:
    """
    Normalize different violation labels into one PPE category.

    Examples:
        hardhat -> hardhat
        NO-Hardhat -> hardhat
        no_hardhat -> hardhat
        missing_hardhat -> hardhat

        Safety Vest -> vest
        NO-Safety Vest -> vest
        missing_vest -> vest
    """

    if not value:
        return "unknown"

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

    if normalized in {
        "hard_hat",
        "hardhat",
    }:
        return "hardhat"

    if normalized in {
        "face_mask",
        "mask",
    }:
        return "mask"

    if normalized in {
        "glove",
        "gloves",
    }:
        return "gloves"

    return normalized


def display_violation_name(
    value: str,
) -> str:
    """
    Convert the normalized database name into a
    clean dashboard label.
    """

    labels = {
        "hardhat": "Hardhat",
        "vest": "Vest",
        "mask": "Mask",
        "gloves": "Gloves",
    }

    return labels.get(
        value,
        value.replace(
            "_",
            " ",
        ).title(),
    )


# ============================================================
# SUMMARY
# ============================================================

def summary(
    db: Session,
) -> dict:
    now = datetime.now(
        timezone.utc
    )

    start_today = now.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )


    # --------------------------------------------------------
    # INCIDENTS TODAY
    # --------------------------------------------------------

    incidents_today = (
        db.scalar(
            select(
                func.count(
                    Incident.id
                )
            )
            .where(
                Incident.detected_at
                >= start_today
            )
        )
        or 0
    )


    # --------------------------------------------------------
    # OPEN INCIDENTS
    # --------------------------------------------------------

    open_incidents = (
        db.scalar(
            select(
                func.count(
                    Incident.id
                )
            )
            .where(
                Incident.status.in_(
                    [
                        "open",
                        "reviewing",
                    ]
                )
            )
        )
        or 0
    )


    # --------------------------------------------------------
    # COMPLIANCE RATE
    # --------------------------------------------------------

    total_obs = (
        db.scalar(
            select(
                func.count(
                    ComplianceObservation.id
                )
            )
        )
        or 0
    )

    compliant_obs = (
        db.scalar(
            select(
                func.count(
                    ComplianceObservation.id
                )
            )
            .where(
                ComplianceObservation
                .is_compliant
                .is_(True)
            )
        )
        or 0
    )

    compliance_rate = (
        compliant_obs
        / total_obs
        * 100.0
    ) if total_obs else None


    # --------------------------------------------------------
    # TOP VIOLATION
    #
    # Important:
    # Count raw DB labels first, then combine equivalent
    # labels such as:
    #
    # hardhat
    # NO-Hardhat
    # missing_hardhat
    #
    # into one "hardhat" category.
    # --------------------------------------------------------

    violation_rows = db.execute(
        select(
            Incident.violation_type,
            func.count(
                Incident.id
            ).label("count"),
        )
        .group_by(
            Incident.violation_type
        )
    ).all()


    violation_counts: dict[
        str,
        int,
    ] = {}


    for row in violation_rows:
        normalized_name = (
            normalize_violation_type(
                row.violation_type
            )
        )

        violation_counts[
            normalized_name
        ] = (
            violation_counts.get(
                normalized_name,
                0,
            )
            + int(row.count)
        )


    if violation_counts:
        top_violation_key = max(
            violation_counts,
            key=violation_counts.get,
        )

        most_common_violation = (
            display_violation_name(
                top_violation_key
            )
        )

    else:
        most_common_violation = None


    # --------------------------------------------------------
    # HIGHEST-RISK LOCATION
    # --------------------------------------------------------

    risk_row = db.execute(
        select(
            Site.name,
            func.count(
                Incident.id
            ).label("n"),
        )
        .join(
            Camera,
            Camera.site_id
            == Site.id,
        )
        .join(
            Incident,
            Incident.camera_id
            == Camera.id,
        )
        .group_by(
            Site.name
        )
        .order_by(
            func.count(
                Incident.id
            ).desc()
        )
        .limit(1)
    ).first()


    # --------------------------------------------------------
    # AVERAGE RESOLUTION TIME
    # --------------------------------------------------------

    avg_resolution_seconds = (
        db.scalar(
            select(
                func.avg(
                    func.extract(
                        "epoch",
                        Incident.resolved_at
                        - Incident.detected_at,
                    )
                )
            )
            .where(
                Incident.resolved_at
                .is_not(None)
            )
        )
    )


    # --------------------------------------------------------
    # DUPLICATE REDUCTION
    # --------------------------------------------------------

    raw_violations = (
        db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        ComplianceObservation
                        .missing_count
                    ),
                    0,
                )
            )
        )
        or 0
    )


    unique_incidents = (
        db.scalar(
            select(
                func.count(
                    Incident.id
                )
            )
        )
        or 0
    )


    duplicate_reduction = (
        (
            raw_violations
            - unique_incidents
        )
        / raw_violations
        * 100.0
    ) if raw_violations else None


    # --------------------------------------------------------
    # RESPONSE
    # --------------------------------------------------------

    return {
        "incidents_today":
            incidents_today,

        "open_incidents":
            open_incidents,

        "compliance_rate":
            round(
                compliance_rate,
                2,
            )
            if compliance_rate
            is not None
            else None,

        "most_common_violation":
            most_common_violation,

        "highest_risk_location":
            risk_row[0]
            if risk_row
            else None,

        "avg_resolution_minutes":
            round(
                float(
                    avg_resolution_seconds
                )
                / 60.0,
                2,
            )
            if avg_resolution_seconds
            is not None
            else None,

        "duplicate_reduction_pct":
            round(
                duplicate_reduction,
                2,
            )
            if duplicate_reduction
            is not None
            else None,

        "raw_violation_observations":
            raw_violations,

        "unique_incidents":
            unique_incidents,
    }


# ============================================================
# INCIDENT TREND
# ============================================================

def trend(
    db: Session,
    days: int = 14,
) -> list[dict]:

    cutoff = (
        datetime.now(
            timezone.utc
        )
        - timedelta(
            days=days
        )
    )

    date_col = func.date(
        Incident.detected_at
    )


    rows = db.execute(
        select(
            date_col.label(
                "date"
            ),
            func.count(
                Incident.id
            ).label(
                "count"
            ),
        )
        .where(
            Incident.detected_at
            >= cutoff
        )
        .group_by(
            date_col
        )
        .order_by(
            date_col
        )
    ).all()


    return [
        {
            "date":
                str(row.date),

            "count":
                row.count,
        }
        for row in rows
    ]