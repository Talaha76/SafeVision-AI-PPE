
# ============================================================
# SAFEVISION AI — HEALTH API TEST
# ============================================================
#
# Verifies that the backend health endpoint is reachable
# and returns the expected success response.
#
# ============================================================

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
