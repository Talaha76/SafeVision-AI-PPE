# Migration from the Original SafeVision AI Project

## Original -> upgraded mapping

| Original asset | Upgraded location / use |
|---|---|
| `Live Image Detection/ppe.pt` | `ml/weights/ppe.pt` |
| `Yolo-Webcam.py` | preserved in `legacy/original_project/`; logic refactored into detector/tracker/worker services |
| manual 25-class list | model labels are now read from YOLO results and normalized in `backend/app/services/detector.py` |
| webcam `cv2.VideoCapture(1)` | configurable `--source 0`, file path, or RTSP source |
| positive/negative color rules | replaced by structured canonical PPE/violation names for backend logic |
| no persistence | PostgreSQL + SQLAlchemy + Alembic |
| no API | FastAPI routes under `/api` |
| no dashboard | React/Vite/Recharts frontend |
| no tracking | ByteTrack using the model's real `Person` class |
| repeated frame detections | incident cooldown deduplication by camera + track + violation |
| ~94% accuracy README claim | must be reproduced with `ml/evaluation/evaluate_yolo.py` before using on resume |

## What was intentionally not copied

The top-level uploaded archive also contained `Customer-Feedback-ETL-Pipeline-main (1).zip`. That is unrelated to SafeVision and was excluded from this upgraded ZIP.
