# ============================================================
# SAFEVISION AI — HEALTH API
# ============================================================
#
# Provides a simple health-check endpoint to confirm that
# the backend API is running and reachable.
#
# Route:
# GET /health
#
# ============================================================

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
