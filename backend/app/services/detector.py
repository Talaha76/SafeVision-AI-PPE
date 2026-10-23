# ============================================================
# SAFEVISION AI — LEGACY PPE DETECTOR
# ============================================================
#
# Old server-side YOLO PPE detection service.
# Replaced by browser-based ONNX inference.
#
# ============================================================

from dataclasses import dataclass
import re
import numpy as np
from ultralytics import YOLO
from app.core.config import settings


# Normalize the real labels used by the uploaded SafeVision model into stable
# names the rules engine and database can use.
CLASS_ALIASES = {
    "hardhat": "hardhat",
    "safety vest": "vest",
    "gloves": "gloves",
    "mask": "mask",
    "person": "person",
    "no hardhat": "no_hardhat",
    "no safety vest": "no_vest",
    "no mask": "no_mask",
    "no gloves": "no_gloves",
}

POSITIVE_PPE = {"hardhat", "vest", "gloves", "mask"}
NEGATIVE_PPE = {"no_hardhat", "no_vest", "no_gloves", "no_mask"}


def normalize_class_name(name: str) -> str:
    """Normalize labels such as `NO-Safety Vest` -> `no_vest`."""
    spaced = re.sub(r"[_-]+", " ", name.strip().lower())
    spaced = re.sub(r"\s+", " ", spaced)
    return CLASS_ALIASES.get(spaced, spaced.replace(" ", "_"))


@dataclass(frozen=True)
class Detection:
    raw_class_name: str
    class_name: str
    confidence: float
    xyxy: tuple[float, float, float, float]

    @property
    def is_positive_ppe(self) -> bool:
        return self.class_name in POSITIVE_PPE

    @property
    def is_negative_ppe(self) -> bool:
        return self.class_name in NEGATIVE_PPE


class PPEDetector:
    """Load the uploaded custom PPE model once and reuse it for every frame."""

    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or settings.model_path
        self.model = YOLO(self.model_path)

    @property
    def names(self) -> dict[int, str]:
        names = self.model.names
        if isinstance(names, dict):
            return {int(k): str(v) for k, v in names.items()}
        return {i: str(v) for i, v in enumerate(names)}

    def detect(self, frame: np.ndarray, conf: float = 0.35) -> list[Detection]:
        result = self.model.predict(frame, conf=conf, verbose=False)[0]
        detections: list[Detection] = []
        if result.boxes is None:
            return detections
        names = result.names
        for box in result.boxes:
            class_id = int(box.cls.item())
            raw_name = str(names[class_id])
            detections.append(
                Detection(
                    raw_class_name=raw_name,
                    class_name=normalize_class_name(raw_name),
                    confidence=float(box.conf.item()),
                    xyxy=tuple(float(v) for v in box.xyxy[0].tolist()),
                )
            )
        return detections
