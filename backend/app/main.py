# ============================================================
# SAFEVISION AI — FASTAPI APPLICATION
# ============================================================

from pathlib import Path

from fastapi import FastAPI

from fastapi.middleware.cors import (
    CORSMiddleware,
)

from fastapi.staticfiles import (
    StaticFiles,
)

from sqlalchemy import text

from app.api.analytics import (
    router as analytics_router,
)

from app.api.browser_incidents import (
    router as browser_incidents_router,
)

from app.api.cameras import (
    router as cameras_router,
)

from app.api.health import (
    router as health_router,
)

from app.api.incidents import (
    router as incidents_router,
)

from app.api.model import (
    router as model_router,
)

from app.core.config import (
    settings,
)

from app.db.session import (
    engine,
)


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
)


production_origin = (
    settings
    .frontend_origin
    .rstrip("/")
)


app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        production_origin
    ],

    allow_origin_regex=(
        r"^https?://"
        r"(localhost|127\.0\.0\.1)"
        r"(:\d+)?$"
    ),

    allow_credentials=True,

    allow_methods=[
        "*"
    ],

    allow_headers=[
        "*"
    ],
)


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


Path(
    settings.evidence_dir
).mkdir(
    parents=True,
    exist_ok=True,
)


app.mount(
    "/evidence",

    StaticFiles(
        directory=(
            settings.evidence_dir
        )
    ),

    name="evidence",
)


@app.post(
    "/api/admin/clear-data"
)
def clear_dashboard_data():
    with engine.begin() as connection:

        connection.execute(
            text(
                """
                DELETE FROM incident_evidence
                WHERE incident_id IN (
                    SELECT id
                    FROM incidents
                    WHERE is_demo = FALSE
                )
                """
            )
        )

        connection.execute(
            text(
                """
                DELETE FROM incidents
                WHERE is_demo = FALSE
                """
            )
        )

        connection.execute(
            text(
                """
                TRUNCATE TABLE
                    compliance_observations,
                    detection_events
                RESTART IDENTITY
                """
            )
        )

        # After clearing a demo session,
        # make the next live incident #6 again.
        connection.execute(
            text(
                """
                SELECT setval(
                    pg_get_serial_sequence(
                        'incidents',
                        'id'
                    ),
                    COALESCE(
                        (
                            SELECT MAX(id)
                            FROM incidents
                        ),
                        1
                    ),
                    EXISTS(
                        SELECT 1
                        FROM incidents
                    )
                )
                """
            )
        )

    return {
        "status":
            "ok",

        "message":
            (
                "Session data cleared. "
                "Demo incidents #1-#5 "
                "were preserved."
            ),
    }


@app.get("/")
def root():
    return {
        "app":
            settings.app_name,

        "status":
            "ok",
    }