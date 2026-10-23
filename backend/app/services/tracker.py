# ============================================================
# SAFEVISION AI — LEGACY PERSON TRACKER
# ============================================================
#
# Tracks detected people with ByteTrack and associates
# PPE detections with each tracked person.
#
# ============================================================

from dataclasses import dataclass
import numpy as np
from ultralytics import YOLO
from app.core.config import settings
from app.services.detector import Detection, normalize_class_name


@dataclass(frozen=True)
class TrackedPerson:
    track_id: int
    confidence: float
    xyxy: tuple[float, float, float, float]


def _find_class_id(names, target: str) -> int:
    items = names.items() if isinstance(names, dict) else enumerate(names)
    for class_id, name in items:
        if normalize_class_name(str(name)) == normalize_class_name(target):
            return int(class_id)
    raise RuntimeError(
        f"Could not find class '{target}' in tracking model. Available classes: "
        + ", ".join(str(v) for _, v in items)
    )


class PersonTracker:
    """Track the uploaded model's `Person` class with Ultralytics ByteTrack."""

    def __init__(self, model_path: str | None = None):
        # The original SafeVision model already includes a Person class, so no
        # additional model download is required by default.
        resolved_path = model_path or settings.person_model_path or settings.model_path
        self.model = YOLO(resolved_path)
        self.person_class_id = _find_class_id(self.model.names, settings.person_class_name)

    def track(self, frame: np.ndarray, conf: float = 0.35) -> list[TrackedPerson]:
        result = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=[self.person_class_id],
            conf=conf,
            verbose=False,
        )[0]
        people: list[TrackedPerson] = []
        if result.boxes is None or result.boxes.id is None:
            return people
        for box in result.boxes:
            people.append(
                TrackedPerson(
                    track_id=int(box.id.item()),
                    confidence=float(box.conf.item()),
                    xyxy=tuple(float(v) for v in box.xyxy[0].tolist()),
                )
            )
        return people


def _center(box: tuple[float, float, float, float]) -> tuple[float, float]:
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _inside(point: tuple[float, float], box: tuple[float, float, float, float]) -> bool:
    x, y = point
    x1, y1, x2, y2 = box
    return x1 <= x <= x2 and y1 <= y <= y2


def associate_detections(
    people: list[TrackedPerson], detections: list[Detection]
) -> dict[int, list[Detection]]:
    """Assign each detection to the smallest tracked-person box containing its center."""
    assigned: dict[int, list[Detection]] = {p.track_id: [] for p in people}
    for item in detections:
        point = _center(item.xyxy)
        candidates = [p for p in people if _inside(point, p.xyxy)]
        if not candidates:
            continue
        person = min(
            candidates,
            key=lambda p: (p.xyxy[2] - p.xyxy[0]) * (p.xyxy[3] - p.xyxy[1]),
        )
        assigned[person.track_id].append(item)
    return assigned


def associate_ppe(people: list[TrackedPerson], ppe: list[Detection]) -> dict[int, set[str]]:
    """Backwards-compatible helper used by tests/experiments."""
    grouped = associate_detections(people, ppe)
    return {track_id: {d.class_name for d in items} for track_id, items in grouped.items()}
