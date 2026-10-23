# ============================================================
# SAFEVISION AI — ALERT SERVICE
# ============================================================
#
# Sends webhook alerts for high-severity PPE incidents
# and logs alerts when no webhook is configured.
#
# ============================================================

import json
import logging
from urllib.request import Request, urlopen
from app.core.config import settings
from app.db.models import Incident

logger = logging.getLogger(__name__)


def send_incident_alert(incident: Incident) -> None:
    """Send a generic webhook alert. Slack incoming webhooks accept the {text: ...} shape."""
    if incident.severity not in {"high", "critical"}:
        return
    message = (
        f"SafeVision {incident.severity.upper()} PPE incident #{incident.id}: "
        f"missing {incident.violation_type}, camera={incident.camera_id}, track={incident.track_id}"
    )
    if not settings.alert_webhook_url:
        logger.warning("ALERT (webhook not configured): %s", message)
        return
    body = json.dumps({"text": message}).encode("utf-8")
    req = Request(settings.alert_webhook_url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=5) as response:
            if response.status >= 400:
                logger.error("Alert webhook returned status %s", response.status)
    except Exception:
        logger.exception("Failed to send incident alert")
