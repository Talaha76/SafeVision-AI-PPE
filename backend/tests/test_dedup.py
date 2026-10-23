# ============================================================
# SAFEVISION AI — DEDUPLICATION TEST
# ============================================================
#
# Verifies that duplicate PPE incidents for the same camera,
# track, and violation are suppressed within the cooldown.
#
# ============================================================

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.db.base import Base
from app.db.models import Camera, Site
from app.schemas.incidents import IncidentCreate
from app.services.incident_service import create_incident_if_new


def test_duplicate_incident_is_suppressed():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        site = Site(name="Test", location="Lab")
        db.add(site); db.flush()
        camera = Camera(site_id=site.id, name="Cam", zone="loading_bay", stream_source="test.mp4")
        db.add(camera); db.commit()
        payload = IncidentCreate(
            camera_id=camera.id, track_id=7, violation_type="hardhat",
            missing_ppe=["hardhat"], severity="high", confidence=.9
        )
        first, created1 = create_incident_if_new(db, payload)
        second, created2 = create_incident_if_new(db, payload)
        assert created1 is True
        assert created2 is False
        assert first.id == second.id
