# ============================================================
# SAFEVISION AI — CAMERA SCHEMAS
# ============================================================
#
# Defines the request and response data models used to
# create, update, and return camera records through the API.
#
# ============================================================

from pydantic import BaseModel, ConfigDict


class CameraCreate(BaseModel):
    site_id: int
    name: str
    zone: str = "general"
    stream_source: str
    active: bool = True


class CameraPatch(BaseModel):
    name: str | None = None
    zone: str | None = None
    stream_source: str | None = None
    active: bool | None = None


class CameraRead(CameraCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
