# ============================================================
# SAFEVISION AI — LEGACY UPLOAD DETECTION API
# ============================================================
#
# Old server-side image/video detection pipeline.
# Replaced by browser-based ONNX upload detection.
#
# ============================================================

from math import hypot

import cv2
import numpy as np

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.detector import PPEDetector
from app.services.tracker import PersonTracker


router = APIRouter(
    prefix="/upload-detection",
    tags=["upload-detection"],
)

# Load the PPE model once when FastAPI starts.
detector = PPEDetector()


NEGATIVE_PPE_CLASS_MAP = {
    "no_hardhat": "hardhat",
    "no_mask": "mask",
    "no_safety_vest": "vest",
    "no_vest": "vest",
}


def normalize_class_name(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def get_box(obj) -> list[float]:
    if hasattr(obj, "xyxy"):
        return [float(v) for v in obj.xyxy]

    if hasattr(obj, "bbox"):
        return [float(v) for v in obj.bbox]

    return [
        float(obj.x1),
        float(obj.y1),
        float(obj.x2),
        float(obj.y2),
    ]


def box_center(box: list[float]) -> tuple[float, float]:
    x1, y1, x2, y2 = box
    return (
        (x1 + x2) / 2.0,
        (y1 + y2) / 2.0,
    )


def point_inside_expanded_box(
    point: tuple[float, float],
    box: list[float],
    margin_ratio: float = 0.14,
) -> bool:
    x1, y1, x2, y2 = box
    px, py = point

    width = max(x2 - x1, 1.0)
    height = max(y2 - y1, 1.0)

    margin_x = width * margin_ratio
    margin_y = height * margin_ratio

    return (
        x1 - margin_x <= px <= x2 + margin_x
        and y1 - margin_y <= py <= y2 + margin_y
    )


def associate_violations(
    people,
    detections,
) -> list[dict]:
    """
    Associate explicit negative PPE detections with tracked workers.

    The current PPE model supports explicit negative classes for:
    - NO-Hardhat
    - NO-Mask
    - NO-Safety Vest

    There is intentionally no fabricated NO-Gloves rule here because the
    current model does not have a NO-Gloves class.
    """

    person_records = [
        {
            "track_id": int(person.track_id),
            "confidence": float(person.confidence),
            "box": get_box(person),
        }
        for person in people
    ]

    violations: list[dict] = []
    best_by_worker_and_ppe: dict[tuple[int, str], dict] = {}

    for detection in detections:
        normalized = normalize_class_name(
            detection.class_name
        )

        missing_ppe = NEGATIVE_PPE_CLASS_MAP.get(
            normalized
        )

        if missing_ppe is None:
            continue

        violation_box = get_box(detection)
        violation_center = box_center(
            violation_box
        )

        candidates = [
            person
            for person in person_records
            if point_inside_expanded_box(
                violation_center,
                person["box"],
            )
        ]

        matched_person = None

        if candidates:
            matched_person = min(
                candidates,
                key=lambda person: hypot(
                    box_center(person["box"])[0]
                    - violation_center[0],
                    box_center(person["box"])[1]
                    - violation_center[1],
                ),
            )

        violation = {
            "track_id": (
                matched_person["track_id"]
                if matched_person
                else None
            ),
            "missing_ppe": missing_ppe,
            "violation_type": (
                f"missing_{missing_ppe}"
            ),
            "confidence": float(
                detection.confidence
            ),
            "person_box": (
                matched_person["box"]
                if matched_person
                else None
            ),
            "violation_box": violation_box,
        }

        # For tracked people, keep only the strongest detection for the same
        # worker + missing-PPE pair in this frame.
        if matched_person:
            key = (
                matched_person["track_id"],
                missing_ppe,
            )

            current = best_by_worker_and_ppe.get(
                key
            )

            if (
                current is None
                or violation["confidence"]
                > current["confidence"]
            ):
                best_by_worker_and_ppe[
                    key
                ] = violation
        else:
            # Keep unmatched negative detections too so the frontend can still
            # display a red missing-PPE box even if tracking briefly misses the
            # worker on that frame.
            violations.append(violation)

    violations.extend(
        best_by_worker_and_ppe.values()
    )

    return violations


@router.websocket("/ws")
async def upload_detection(
    websocket: WebSocket,
):
    """
    Analysis-only image/video detection.

    IMPORTANT:
    This endpoint intentionally does NOT write anything to PostgreSQL.
    Uploaded media never creates dashboard incidents or modifies analytics.
    """

    await websocket.accept()

    # One tracker is kept for the lifetime of the WebSocket so track IDs can
    # remain stable while an uploaded video is analyzed frame by frame.
    tracker = PersonTracker()

    try:
        while True:
            image_bytes = (
                await websocket.receive_bytes()
            )

            np_buffer = np.frombuffer(
                image_bytes,
                dtype=np.uint8,
            )

            frame = cv2.imdecode(
                np_buffer,
                cv2.IMREAD_COLOR,
            )

            if frame is None:
                await websocket.send_json(
                    {
                        "error": (
                            "Could not decode frame"
                        ),
                    }
                )
                continue

            detections = detector.detect(frame)
            people = tracker.track(frame)

            violations = associate_violations(
                people,
                detections,
            )

            height, width = frame.shape[:2]

            response = {
                "frame_width": width,
                "frame_height": height,

                "people": [
                    {
                        "track_id": int(
                            person.track_id
                        ),
                        "confidence": float(
                            person.confidence
                        ),
                        "box": get_box(person),
                    }
                    for person in people
                ],

                "detections": [
                    {
                        "class_name": (
                            det.class_name
                        ),
                        "confidence": float(
                            det.confidence
                        ),
                        "box": get_box(det),
                    }
                    for det in detections
                ],

                "violations": violations,
            }

            await websocket.send_json(
                response
            )

    except WebSocketDisconnect:
        pass
