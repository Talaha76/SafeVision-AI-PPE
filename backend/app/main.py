from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import analytics, cameras, health, incidents, model
from app.core.config import settings
from app.api.live_detection import router as live_detection_router
from app.api.upload_detection import router as upload_detection_router

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(cameras.router, prefix="/api")
app.include_router(model.router, prefix="/api")

app.include_router(
    live_detection_router,
    prefix="/api",
)

app.include_router(
    upload_detection_router,
    prefix="/api",
)

Path(settings.evidence_dir).mkdir(parents=True, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=settings.evidence_dir), name="evidence")
