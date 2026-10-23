# ============================================================
# SAFEVISION AI — LEGACY VIDEO WORKER
# ============================================================
#
# Old server-side video processing pipeline using YOLO,
# ByteTrack, PPE rules, incident creation, and evidence saving.
#
# ============================================================

import argparse

import cv2

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


def run(
    source: str,
    camera_id: int,
    max_frames: int | None = None,
) -> None:
    """
    Process a webcam or video file through
    SafeVision's PPE pipeline.

    Pipeline:

    video
        ->
    YOLO
        ->
    ByteTrack
        ->
    PPE association
        ->
    PPE rules
        ->
    incident deduplication
        ->
    PostgreSQL
        ->
    annotated evidence
    """

    # =========================================
    # DATABASE
    # =========================================

    db = SessionLocal()


    camera = db.get(
        Camera,
        camera_id,
    )


    if camera is None:

        db.close()

        raise RuntimeError(
            f"Camera {camera_id} "
            "does not exist. "
            "Run the seed script first."
        )


    # =========================================
    # MODEL + TRACKER
    # =========================================

    detector = PPEDetector()

    tracker = PersonTracker()


    # =========================================
    # VIDEO SOURCE
    # =========================================

    video_source = (
        0
        if source == "0"
        else source
    )


    cap = cv2.VideoCapture(
        video_source
    )


    if not cap.isOpened():

        db.close()

        raise RuntimeError(
            f"Could not open "
            f"video source: {source}"
        )


    frame_count = 0


    try:

        while cap.isOpened():

            # =================================
            # READ FRAME
            # =================================

            ok, frame = cap.read()


            if not ok:
                break


            frame_count += 1


            if (
                max_frames is not None
                and
                frame_count > max_frames
            ):
                break


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
            # 3. PPE -> PERSON ASSOCIATION
            # =================================

            assigned = (
                associate_detections(
                    people,
                    detections,
                )
            )


            # =================================
            # 4. RAW DETECTION EVENTS
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


            # =================================
            # 5. PROCESS TRACKED PEOPLE
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
                # NEGATIVE PPE DETECTIONS
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
                # 6. COMPLIANCE OBSERVATION
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


                # =================================
                # 7. CREATE INCIDENTS
                # =================================

                for missing_item in (
                    rule.missing_ppe
                ):

                    # Find actual negative PPE
                    # detector result.
                    #
                    # hardhat
                    #    -> NO-Hardhat
                    #
                    # vest
                    #    -> NO-Safety Vest

                    violation_detection = (
                        find_violation_detection(
                            person_detections,
                            missing_item,
                        )
                    )


                    # Use PPE detection confidence
                    # whenever possible.
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
                    # INCIDENT PAYLOAD
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
                    # INCIDENT DEDUPLICATION
                    # -----------------------------

                    incident, created = (
                        create_incident_if_new(
                            db,
                            payload,
                        )
                    )


                    # =================================
                    # 8. SAVE EVIDENCE
                    # =================================

                    if created:

                        save_evidence_to_db(
                            db=db,

                            frame=frame,

                            incident_id=(
                                incident.id
                            ),

                            # BLUE BOX
                            # Tracked person.
                            person_box=(
                                person.xyxy
                            ),

                            track_id=(
                                person.track_id
                            ),

                            # RED BOX
                            # Actual violation.
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


                        # Save incident and evidence.
                        db.commit()

                        db.refresh(
                            incident
                        )


                        # Send optional alert.
                        send_incident_alert(
                            incident
                        )


            # =================================
            # 9. COMMIT EVENTS / OBSERVATIONS
            # =================================

            db.commit()


    except KeyboardInterrupt:

        print(
            "\nSafeVision worker stopped."
        )


    except Exception:

        db.rollback()

        raise


    finally:

        cap.release()

        db.close()


if __name__ == "__main__":

    parser = argparse.ArgumentParser(
        description=(
            "SafeVision AI PPE "
            "video detection worker"
        )
    )


    parser.add_argument(
        "--source",
        required=True,

        help=(
            "Video source. "
            "Use 0 for webcam or "
            "provide a video file path."
        ),
    )


    parser.add_argument(
        "--camera-id",
        type=int,
        required=True,

        help=(
            "SafeVision camera ID "
            "from PostgreSQL."
        ),
    )


    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,

        help=(
            "Optional maximum number "
            "of frames to process."
        ),
    )


    args = parser.parse_args()


    run(
        source=args.source,

        camera_id=args.camera_id,

        max_frames=args.max_frames,
    )