# ============================================================
# SAFEVISION AI — DATABASE MODELS
# ============================================================

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    func,
)

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.db.base import Base


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    name: Mapped[str] = mapped_column(
        String(120),
        unique=True,
        nullable=False,
    )

    location: Mapped[Optional[str]] = mapped_column(
        String(255),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    cameras: Mapped[list["Camera"]] = relationship(
        back_populates="site",
        cascade="all, delete-orphan",
    )


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    site_id: Mapped[int] = mapped_column(
        ForeignKey(
            "sites.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    zone: Mapped[str] = mapped_column(
        String(80),
        default="general",
        nullable=False,
    )

    stream_source: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    site: Mapped["Site"] = relationship(
        back_populates="cameras",
    )

    incidents: Mapped[list["Incident"]] = relationship(
        back_populates="camera",
    )


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    camera_id: Mapped[int] = mapped_column(
        ForeignKey(
            "cameras.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    track_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    violation_type: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    missing_ppe: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
    )

    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    confidence: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="open",
        index=True,
    )

    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
    )

    notes: Mapped[Optional[str]] = mapped_column(
        Text,
    )

    evidence_path: Mapped[Optional[str]] = mapped_column(
        String(500),
    )

    is_demo: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
    )

    camera: Mapped["Camera"] = relationship(
        back_populates="incidents",
    )


class IncidentEvidence(Base):
    __tablename__ = "incident_evidence"

    id = mapped_column(
        Integer,
        primary_key=True,
    )

    incident_id = mapped_column(
        ForeignKey(
            "incidents.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    image_data = mapped_column(
        LargeBinary,
        nullable=False,
    )

    mime_type = mapped_column(
        String(50),
        default="image/jpeg",
    )

    created_at = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    camera_id: Mapped[int] = mapped_column(
        ForeignKey(
            "cameras.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    track_id: Mapped[Optional[int]] = mapped_column(
        Integer,
    )

    class_name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class ComplianceObservation(Base):
    __tablename__ = "compliance_observations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    camera_id: Mapped[int] = mapped_column(
        ForeignKey(
            "cameras.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    track_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    is_compliant: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
    )

    missing_ppe: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
    )

    missing_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    model_version: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    source: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    avg_latency_ms: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    fps: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    precision: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    recall: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    f1: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    map50: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    map50_95: Mapped[Optional[float]] = mapped_column(
        Float,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )