from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.analytics import router as analytics_router
from app.api.browser_incidents import router as browser_incidents_router
from app.api.cameras import router as cameras_router
from app.api.health import router as health_router
from app.api.incidents import router as incidents_router
from app.api.model import router as model_router

from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
)


production_origin = (
    settings.frontend_origin
    .rstrip("/")
)


app.add_middleware(
    CORSMiddleware,

    # Production frontend, e.g. Netlify.
    allow_origins=[
        production_origin,
    ],

    # Also allow local Vite development.
    allow_origin_regex=(
        r"^https?://"
        r"(localhost|127\.0\.0\.1)"
        r"(:\d+)?$"
    ),

    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------

app.include_router(
    health_router,
    prefix="/api",
)

app.include_router(
    incidents_router,
    prefix="/api",
)

app.include_router(
    browser_incidents_router,
    prefix="/api",
)

app.include_router(
    analytics_router,
    prefix="/api",
)

app.include_router(
    cameras_router,
    prefix="/api",
)

app.include_router(
    model_router,
    prefix="/api",
)


# ---------------------------------------------------------
# EVIDENCE
# ---------------------------------------------------------

Path(
    settings.evidence_dir
).mkdir(
    parents=True,
    exist_ok=True,
)


app.mount(
    "/evidence",
    StaticFiles(
        directory=settings.evidence_dir,
    ),
    name="evidence",
)


@app.get("/")
def root():
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "docs": "/docs",
    }