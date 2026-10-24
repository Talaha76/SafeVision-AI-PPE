# ============================================================
# SAFEVISION AI — INCIDENT SCHEMAS
# ============================================================

from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
)


Status = Literal[
    "open",
    "reviewing",
    "resolved",
    "dismissed",
]

Severity = Literal[
    "low",
    "medium",
    "high",
    "critical",
]


class IncidentCreate(BaseModel):
    camera_id: int

    track_id: int

    violation_type: str = Field(
        min_length=1,
        max_length=120,
    )

    missing_ppe: list[str]

    severity: Severity

    confidence: float | None = Field(
        default=None,
        ge=0,
        le=1,
    )

    evidence_path: str | None = None


class IncidentPatch(BaseModel):
    status: Status | None = None
    notes: str | None = None


class IncidentRead(IncidentCreate):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int

    detected_at: datetime

    status: Status

    resolved_at: datetime | None = None

    is_demo: bool = False