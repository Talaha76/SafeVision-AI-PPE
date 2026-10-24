# ============================================================
# SAFEVISION AI — EVIDENCE SERVICE
# ============================================================
#
# Stores incident evidence in PostgreSQL.
#
# Normal/live evidence is limited to the latest configured
# records. Permanent demo evidence is never pruned.
#
# ============================================================

from sqlalchemy import (
    delete,
    select,
)

from sqlalchemy.orm import Session

from app.db.models import (
    Incident,
    IncidentEvidence,
)


def _prune_old_evidence(
    db: Session,
    keep_latest: int = 100,
) -> None:
    if keep_latest <= 0:
        return

    old_evidence_ids = db.scalars(
        select(
            IncidentEvidence.id
        )
        .join(
            Incident,
            Incident.id
            == IncidentEvidence.incident_id,
        )
        .where(
            Incident.is_demo.is_(False)
        )
        .order_by(
            IncidentEvidence.created_at.desc(),
            IncidentEvidence.id.desc(),
        )
        .offset(
            keep_latest
        )
    ).all()

    if old_evidence_ids:
        db.execute(
            delete(
                IncidentEvidence
            ).where(
                IncidentEvidence.id.in_(
                    old_evidence_ids
                )
            )
        )


def save_evidence_bytes_to_db(
    db: Session,
    incident_id: int,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    keep_latest: int = 100,
) -> int:
    if not image_bytes:
        raise ValueError(
            "Evidence image is empty."
        )

    evidence = IncidentEvidence(
        incident_id=incident_id,
        image_data=image_bytes,
        mime_type=mime_type,
    )

    db.add(
        evidence
    )

    db.flush()

    _prune_old_evidence(
        db,
        keep_latest=keep_latest,
    )

    return evidence.id


# ============================================================
# LEGACY SERVER-SIDE EVIDENCE SUPPORT
# ============================================================


def _clip_box(
    box,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (
        int(float(value))
        for value in box
    )

    x1 = max(
        0,
        min(
            x1,
            width - 1,
        ),
    )

    y1 = max(
        0,
        min(
            y1,
            height - 1,
        ),
    )

    x2 = max(
        0,
        min(
            x2,
            width - 1,
        ),
    )

    y2 = max(
        0,
        min(
            y2,
            height - 1,
        ),
    )

    return (
        x1,
        y1,
        x2,
        y2,
    )


def _draw_labeled_box(
    cv2,
    image,
    box,
    label: str,
    color: tuple[int, int, int],
    thickness: int = 2,
) -> None:
    height, width = image.shape[:2]

    x1, y1, x2, y2 = _clip_box(
        box,
        width,
        height,
    )

    cv2.rectangle(
        image,
        (
            x1,
            y1,
        ),
        (
            x2,
            y2,
        ),
        color,
        thickness,
    )

    font = cv2.FONT_HERSHEY_SIMPLEX

    font_scale = 0.6

    font_thickness = 2

    (
        text_width,
        text_height,
    ), baseline = cv2.getTextSize(
        label,
        font,
        font_scale,
        font_thickness,
    )

    label_top = max(
        0,
        y1
        - text_height
        - baseline
        - 10,
    )

    label_bottom = max(
        text_height
        + baseline
        + 8,
        y1,
    )

    label_right = min(
        width - 1,
        x1
        + text_width
        + 12,
    )

    cv2.rectangle(
        image,
        (
            x1,
            label_top,
        ),
        (
            label_right,
            label_bottom,
        ),
        color,
        -1,
    )

    text_y = (
        label_bottom
        - baseline
        - 4
    )

    cv2.putText(
        image,
        label,
        (
            x1 + 6,
            text_y,
        ),
        font,
        font_scale,
        (
            255,
            255,
            255,
        ),
        font_thickness,
        cv2.LINE_AA,
    )


def encode_evidence(
    frame,
    box=None,
    *,
    person_box=None,
    track_id: int | None = None,
    violation_box=None,
    violation_label: str | None = None,
    violation_confidence: float | None = None,
) -> tuple[bytes, str]:
    import cv2

    annotated = frame.copy()

    if person_box is None:
        person_box = box

    if person_box is not None:
        person_label = (
            f"Person / Track #{track_id}"
            if track_id is not None
            else "Person"
        )

        _draw_labeled_box(
            cv2,
            annotated,
            person_box,
            person_label,
            (
                255,
                120,
                30,
            ),
            thickness=2,
        )

    if violation_box is not None:
        label = (
            violation_label
            or "PPE Violation"
        )

        label = (
            label
            .replace(
                "_",
                " ",
            )
            .replace(
                "-",
                " ",
            )
        )

        if (
            violation_confidence
            is not None
        ):
            label = (
                f"{label} "
                f"{violation_confidence * 100:.0f}%"
            )

        _draw_labeled_box(
            cv2,
            annotated,
            violation_box,
            label,
            (
                0,
                0,
                255,
            ),
            thickness=3,
        )

    elif violation_label:
        label = (
            violation_label
            .replace(
                "_",
                " ",
            )
            .replace(
                "-",
                " ",
            )
        )

        if (
            violation_confidence
            is not None
        ):
            label = (
                f"{label} "
                f"{violation_confidence * 100:.0f}%"
            )

        cv2.putText(
            annotated,
            label,
            (
                20,
                35,
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (
                0,
                0,
                255,
            ),
            2,
            cv2.LINE_AA,
        )

    success, encoded = cv2.imencode(
        ".jpg",
        annotated,
        [
            cv2.IMWRITE_JPEG_QUALITY,
            90,
        ],
    )

    if not success:
        raise RuntimeError(
            "Could not encode incident evidence."
        )

    return (
        encoded.tobytes(),
        "image/jpeg",
    )


def save_evidence_to_db(
    db: Session,
    frame,
    incident_id: int,
    box=None,
    keep_latest: int = 100,
    *,
    person_box=None,
    track_id: int | None = None,
    violation_box=None,
    violation_label: str | None = None,
    violation_confidence: float | None = None,
) -> int:
    image_bytes, mime_type = (
        encode_evidence(
            frame,
            box,
            person_box=person_box,
            track_id=track_id,
            violation_box=violation_box,
            violation_label=(
                violation_label
            ),
            violation_confidence=(
                violation_confidence
            ),
        )
    )

    return save_evidence_bytes_to_db(
        db=db,
        incident_id=incident_id,
        image_bytes=image_bytes,
        mime_type=mime_type,
        keep_latest=keep_latest,
    )