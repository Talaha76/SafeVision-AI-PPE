# ============================================================
# SAFEVISION AI — LEGACY LIVE DETECTION API
# ============================================================
#
# Old server-side YOLO/WebSocket detection pipeline.
# Replaced by browser-based ONNX live detection.
#
# ============================================================

import cv2
import numpy as np

from fastapi import (
    APIRouter,
    WebSocket,
    WebSocketDisconnect,
)

from app.core.config import settings

from app.db.models import (
    Camera,
    ComplianceObservation,
    DetectionEvent,
)

from app.db.session import SessionLocal

from app.schemas.incidents import (
    IncidentCreate,
)

from app.services.alerts import (
    send_incident_alert,
)

from app.services.detector import (
    PPEDetector,
)

from app.services.evidence import (
    save_evidence_to_db,
)

from app.services.incident_service import (
    create_incident_if_new,
)

from app.services.rules_engine import (
    evaluate_ppe,
)

from app.services.tracker import (
    PersonTracker,
    associate_detections,
)

from app.services.violation_matching import (
    find_violation_detection,
)


router = APIRouter(
    prefix="/live-detection",
    tags=["live-detection"],
)


# Load the YOLO PPE model once when FastAPI starts.
# This avoids reloading the model for every frame.
detector = PPEDetector()


def get_box(
    obj,
) -> list[float]:
    """
    Convert a detection or tracked-person
    bounding box into JSON-safe coordinates.
    """

    if hasattr(obj, "xyxy"):
        return [
            float(value)
            for value in obj.xyxy
        ]

    return [
        float(obj.x1),
        float(obj.y1),
        float(obj.x2),
        float(obj.y2),
    ]


@router.websocket("/ws")
async def live_detection(
    websocket: WebSocket,
):
    """
    Live browser-camera detection pipeline.

    Browser camera
        -> WebSocket
        -> YOLO
        -> ByteTrack
        -> PPE association
        -> PPE rules
        -> incident deduplication
        -> PostgreSQL
        -> evidence image
        -> React
    """

    await websocket.accept()

    # -----------------------------------------
    # CAMERA ID
    # -----------------------------------------

    try:
        camera_id = int(
            websocket.query_params.get(
                "camera_id",
                "1",
            )
        )

    except ValueError:
        await websocket.send_json(
            {
                "error": (
                    "Invalid camera_id."
                )
            }
        )

        await websocket.close()
        return


    # -----------------------------------------
    # DATABASE SESSION
    # -----------------------------------------

    db = SessionLocal()

    camera = db.get(
        Camera,
        camera_id,
    )

    if camera is None:
        await websocket.send_json(
            {
                "error": (
                    f"Camera {camera_id} "
                    "does not exist. "
                    "Run the seed script first."
                )
            }
        )

        await websocket.close()
        db.close()
        return


    # Each WebSocket connection gets its own
    # tracker state.
    tracker = PersonTracker()


    try:

        while True:

            # =================================
            # RECEIVE FRAME FROM REACT
            # =================================

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
                            "Could not decode frame."
                        )
                    }
                )

                continue


            # =================================
            # 1. YOLO PPE DETECTION
            # =================================

            detections = (
                detector.detect(frame)
            )


            # =================================
            # 2. PERSON TRACKING
            # =================================

            people = (
                tracker.track(frame)
            )


            # =================================
            # 3. ASSOCIATE PPE WITH PEOPLE
            # =================================

            assigned = (
                associate_detections(
                    people,
                    detections,
                )
            )


            # =================================
            # 4. SAVE RAW DETECTION EVENTS
            # =================================

            for detection in detections:

                db.add(
                    DetectionEvent(
                        camera_id=camera_id,
                        class_name=(
                            detection.class_name
                        ),
                        confidence=(
                            detection.confidence
                        ),
                    )
                )


            incidents_created = []

            compliance_results = []


            # =================================
            # 5. PROCESS EACH TRACKED PERSON
            # =================================

            for person in people:

                person_detections = (
                    assigned.get(
                        person.track_id,
                        [],
                    )
                )


                # -----------------------------
                # POSITIVE PPE
                # -----------------------------

                present = {
                    detection.class_name

                    for detection
                    in person_detections

                    if detection.is_positive_ppe
                }


                # -----------------------------
                # EXPLICIT NEGATIVE PPE
                # -----------------------------

                negatives = {
                    detection.class_name

                    for detection
                    in person_detections

                    if detection.is_negative_ppe
                }


                # -----------------------------
                # PPE RULE ENGINE
                # -----------------------------

                rule = evaluate_ppe(
                    camera.zone,
                    present,

                    explicit_negative_classes=(
                        negatives
                    ),

                    absence_based_items=(
                        settings
                        .absence_based_items
                    ),
                )


                # =================================
                # 6. SAVE COMPLIANCE OBSERVATION
                # =================================

                db.add(
                    ComplianceObservation(
                        camera_id=camera_id,

                        track_id=(
                            person.track_id
                        ),

                        is_compliant=(
                            rule.compliant
                        ),

                        missing_ppe=(
                            rule.missing_ppe
                        ),

                        missing_count=len(
                            rule.missing_ppe
                        ),
                    )
                )


                compliance_results.append(
                    {
                        "track_id": (
                            person.track_id
                        ),

                        "compliant": (
                            rule.compliant
                        ),

                        "missing_ppe": (
                            rule.missing_ppe
                        ),
                    }
                )


                # =================================
                # 7. CREATE INCIDENTS
                # =================================

                for missing_item in (
                    rule.missing_ppe
                ):

                    # Find the actual YOLO
                    # violation detection.
                    #
                    # Example:
                    # hardhat
                    #     ->
                    # NO-Hardhat
                    #
                    # vest
                    #     ->
                    # NO-Safety Vest

                    violation_detection = (
                        find_violation_detection(
                            person_detections,
                            missing_item,
                        )
                    )


                    # If YOLO explicitly detected
                    # the negative PPE class, use
                    # THAT confidence.
                    #
                    # Otherwise this may be an
                    # absence-based rule, so fall
                    # back to person confidence.

                    if (
                        violation_detection
                        is not None
                    ):
                        confidence = float(
                            violation_detection
                            .confidence
                        )

                    else:
                        confidence = float(
                            person.confidence
                        )


                    # -----------------------------
                    # BUILD INCIDENT
                    # -----------------------------

                    payload = IncidentCreate(
                        camera_id=camera_id,

                        track_id=(
                            person.track_id
                        ),

                        violation_type=(
                            missing_item
                        ),

                        missing_ppe=[
                            missing_item
                        ],

                        severity=(
                            rule.severity
                        ),

                        confidence=confidence,
                    )


                    # -----------------------------
                    # DEDUPLICATION
                    # -----------------------------

                    incident, created = (
                        create_incident_if_new(
                            db,
                            payload,
                        )
                    )


                    # Only save evidence for a
                    # genuinely new incident.
                    if created:

                        # --------------------------------
                        # EVIDENCE ANNOTATION
                        # --------------------------------
                        #
                        # BLUE:
                        # tracked person
                        #
                        # RED:
                        # actual violation detection
                        #
                        # Example:
                        # NO HARDHAT 91%

                        save_evidence_to_db(
                            db=db,

                            frame=frame,

                            incident_id=(
                                incident.id
                            ),

                            person_box=(
                                person.xyxy
                            ),

                            track_id=(
                                person.track_id
                            ),

                            violation_box=(
                                violation_detection
                                .xyxy

                                if (
                                    violation_detection
                                    is not None
                                )

                                else None
                            ),

                            violation_label=(
                                f"NO "
                                f"{missing_item.upper()}"
                            ),

                            violation_confidence=(
                                confidence
                            ),

                            keep_latest=(
                                settings
                                .evidence_retention_count
                            ),
                        )


                        # Save incident + evidence.
                        db.commit()

                        db.refresh(
                            incident
                        )


                        # Optional alert integration.
                        send_incident_alert(
                            incident
                        )


                        incidents_created.append(
                            {
                                "id": (
                                    incident.id
                                ),

                                "track_id": (
                                    person.track_id
                                ),

                                "violation_type": (
                                    missing_item
                                ),

                                "severity": (
                                    rule.severity
                                ),

                                "confidence": (
                                    confidence
                                ),
                            }
                        )


            # =================================
            # 8. COMMIT EVENTS / OBSERVATIONS
            # =================================

            db.commit()


            # =================================
            # 9. SEND RESULTS BACK TO REACT
            # =================================

            height, width = (
                frame.shape[:2]
            )


            response = {

                "frame_width": width,

                "frame_height": height,


                # -----------------------------
                # PEOPLE / TRACKS
                # -----------------------------

                "people": [

                    {
                        "track_id": (
                            person.track_id
                        ),

                        "confidence": float(
                            person.confidence
                        ),

                        "box": (
                            get_box(person)
                        ),
                    }

                    for person
                    in people
                ],


                # -----------------------------
                # RAW YOLO DETECTIONS
                # -----------------------------

                "detections": [

                    {
                        "class_name": (
                            detection.class_name
                        ),

                        "confidence": float(
                            detection.confidence
                        ),

                        "box": (
                            get_box(
                                detection
                            )
                        ),
                    }

                    for detection
                    in detections
                ],


                # -----------------------------
                # RULE ENGINE RESULTS
                # -----------------------------

                "compliance": (
                    compliance_results
                ),


                # -----------------------------
                # NEW INCIDENTS
                # -----------------------------

                "incidents_created": (
                    incidents_created
                ),
            }


            await websocket.send_json(
                response
            )


    except WebSocketDisconnect:
        # Browser closed the live stream.
        pass


    except Exception as exc:

        db.rollback()

        try:
            await websocket.send_json(
                {
                    "error": (
                        "Live detection error: "
                        f"{str(exc)}"
                    )
                }
            )

        except Exception:
            # Socket may already be closed.
            pass


    finally:
        db.close()