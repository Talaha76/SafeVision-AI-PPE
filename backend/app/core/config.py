from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SafeVision AI"
    database_url: str

    evidence_retention_count: int = 100

    # The uploaded project already includes this trained YOLOv8 model.
    model_path: str = "../ml/weights/ppe.pt"

    # By default ByteTrack also uses the uploaded model's `Person` class.
    # Set a different model path (for example yolov8n.pt) only if you want a
    # dedicated person detector.
    person_model_path: str | None = None
    person_class_name: str = "Person"

    evidence_dir: str = "../evidence"
    incident_cooldown_seconds: int = 30
    frontend_origin: str = "http://localhost:5173"
    alert_webhook_url: str | None = None

    # The uploaded model has explicit negative classes for hardhat, mask and
    # safety vest, but not NO-Gloves. Items listed here may be inferred missing
    # from absence of a positive detection. Keep empty until you intentionally
    # validate an absence-based rule on your footage.
    absence_based_ppe: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def absence_based_items(self) -> set[str]:
        return {x.strip().lower() for x in self.absence_based_ppe.split(",") if x.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
