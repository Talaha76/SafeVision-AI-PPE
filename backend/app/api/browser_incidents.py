# ============================================================
# SAFEVISION AI — BROWSER INCIDENT API
# ============================================================
#
# Receives confirmed PPE violations from the browser.
# Normalizes PPE types, assigns severity, prevents duplicates,
# stores evidence images, and saves incidents to PostgreSQL.
#
# Route:
# POST /api/browser-incidents
#
# ============================================================

import base64
import binascii

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)
from pydantic import (
    BaseModel,
    Field,
)
from sqlalchemy.orm import Session

from app.db.models import Camera
from app.db.session import get_db
from app.schemas.incidents import (
    IncidentCreate,
    IncidentRead,
)
from app.services.evidence import (
    save_evidence_bytes_to_db,
)
from app.services.incident_service import (
    create_incident_if_new,
)

SEVERITY_BY_PPE = {
    "hardhat": "high",
    "vest": "high",
    "mask": "medium",
    "gloves": "medium",
}


router = APIRouter(
    prefix="/browser-incidents",
    tags=["browser-incidents"],
)



MAX_EVIDENCE_BYTES = (
    2_500_000
)


class BrowserIncidentCreate(
    BaseModel
):
    camera_id: int = Field(
        ge=1,
    )

    track_id: int = Field(
        ge=1,
    )

    missing_ppe: str

    confidence: float = Field(
        ge=0.0,
        le=1.0,
    )

    evidence_image: str | None = None


class BrowserIncidentResponse(
    BaseModel
):
    created: bool
    incident: IncidentRead
    evidence_saved: bool


def normalize_missing_ppe(
    value: str,
) -> str:
    normalized = (
        value
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )

    aliases = {
        "hardhat":
            "hardhat",

        "helmet":
            "hardhat",

        "no_hardhat":
            "hardhat",

        "missing_hardhat":
            "hardhat",

        "vest":
            "vest",

        "safety_vest":
            "vest",

        "no_vest":
            "vest",

        "no_safety_vest":
            "vest",

        "missing_vest":
            "vest",

        "mask":
            "mask",

        "no_mask":
            "mask",

        "missing_mask":
            "mask",

        "gloves":
            "gloves",

        "glove":
            "gloves",

        "no_gloves":
            "gloves",

        "no_glove":
            "gloves",

        "missing_gloves":
            "gloves",

        "missing_glove":
            "gloves",
    }

    result = aliases.get(
        normalized,
    )

    if result is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Expected hardhat, "
                "vest, mask, or gloves."
            ),
        )

    return result


def decode_evidence_image(
    data_url: str,
) -> tuple[bytes, str]:
    """
    Decode a browser data URL such as:

    data:image/jpeg;base64,/9j/4AAQ...
    """

    if not data_url.startswith(
        "data:"
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Evidence image must be "
                "a browser data URL."
            ),
        )

    try:
        header, encoded = (
            data_url.split(
                ",",
                1,
            )
        )
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid evidence image."
            ),
        )

    if ";base64" not in header:
        raise HTTPException(
            status_code=422,
            detail=(
                "Evidence image must "
                "use base64 encoding."
            ),
        )

    mime_type = (
        header
        .removeprefix("data:")
        .split(
            ";",
            1,
        )[0]
        .lower()
    )

    allowed_mime_types = {
        "image/jpeg",
        "image/png",
    }

    if (
        mime_type
        not in allowed_mime_types
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Evidence must be "
                "JPEG or PNG."
            ),
        )

    try:
        image_bytes = (
            base64.b64decode(
                encoded,
                validate=True,
            )
        )
    except (
        binascii.Error,
        ValueError,
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Evidence image "
                "contains invalid base64."
            ),
        )

    if not image_bytes:
        raise HTTPException(
            status_code=422,
            detail=(
                "Evidence image "
                "is empty."
            ),
        )

    if (
        len(image_bytes)
        > MAX_EVIDENCE_BYTES
    ):
        raise HTTPException(
            status_code=413,
            detail=(
                "Evidence image is "
                "too large."
            ),
        )

    return (
        image_bytes,
        mime_type,
    )


@router.post(
    "",
    response_model=(
        BrowserIncidentResponse
    ),
)
def create_browser_incident(
    payload:
        BrowserIncidentCreate,

    db: Session = Depends(
        get_db
    ),
):
    camera = db.get(
        Camera,
        payload.camera_id,
    )

    if camera is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Camera "
                f"{payload.camera_id} "
                "does not exist."
            ),
        )

    missing_ppe = (
        normalize_missing_ppe(
            payload.missing_ppe
        )
    )

    incident_payload = (
        IncidentCreate(
            camera_id=(
                payload.camera_id
            ),

            track_id=(
                payload.track_id
            ),

            violation_type=(
                missing_ppe
            ),

            missing_ppe=[
                missing_ppe,
            ],

            severity=(
                SEVERITY_BY_PPE[
                    missing_ppe
                ]
            ),

            confidence=(
                payload.confidence
            ),

            evidence_path=None,
        )
    )

    incident, created = (
        create_incident_if_new(
            db,
            incident_payload,
        )
    )

    evidence_saved = False

    if (
        created
        and payload.evidence_image
    ):
        image_bytes, mime_type = (
            decode_evidence_image(
                payload.evidence_image
            )
        )

        db.flush()

        save_evidence_bytes_to_db(
            db=db,
            incident_id=incident.id,
            image_bytes=image_bytes,
            mime_type=mime_type,
            keep_latest=100,
        )

        evidence_saved = True

    db.commit()

    db.refresh(
        incident
    )

    return (
        BrowserIncidentResponse(
            created=created,

            incident=(
                IncidentRead
                .model_validate(
                    incident
                )
            ),

            evidence_saved=(
                evidence_saved
            ),
        )
    )
