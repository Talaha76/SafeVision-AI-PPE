# ============================================================
# SAFEVISION AI — CAMERAS API
# ============================================================
#
# Manages camera records in PostgreSQL.
# Supports listing, creating, and updating cameras.
#
# Routes are available under:
# /api/cameras
#
# ============================================================

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import Camera
from app.db.session import get_db
from app.schemas.cameras import CameraCreate, CameraPatch, CameraRead

router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraRead])
def list_cameras(db: Session = Depends(get_db)):
    return list(db.scalars(select(Camera).order_by(Camera.id)).all())


@router.post("", response_model=CameraRead, status_code=201)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    camera = Camera(**payload.model_dump())
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return camera


@router.patch("/{camera_id}", response_model=CameraRead)
def patch_camera(camera_id: int, payload: CameraPatch, db: Session = Depends(get_db)):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(camera, key, value)
    db.commit()
    db.refresh(camera)
    return camera
