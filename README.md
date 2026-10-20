# SafeVision AI — PPE Intelligence Platform

SafeVision AI upgrades the original webcam PPE detector into a small workplace-safety product: real-time YOLOv8 detection, ByteTrack worker IDs, incident deduplication, PostgreSQL persistence, a FastAPI backend, React safety analytics, reproducible model evaluation, tests, Docker, and CI.

**This repository is built from the uploaded original project.** Its trained `ppe.pt` model is included at `ml/weights/ppe.pt`, and the old scripts are preserved under `legacy/original_project/`.

> Resume numbers are targets until measured. Do not claim 94% performance, 5,000+ events, or 80% duplicate reduction until your own evaluation/log queries reproduce them.

## What changed from the original

The original project was a single webcam inference loop. The upgraded flow is:

```text
Camera / video
    ↓
Uploaded YOLOv8 ppe.pt
    ├── PPE + explicit violation detections
    └── Person class + ByteTrack IDs
              ↓
      PPE-to-worker association
              ↓
        Zone rules engine
              ↓
     Incident deduplication
       ↙             ↘
Evidence image     Detection/compliance logs
       ↘             ↙
           PostgreSQL
              ↓
            FastAPI
              ↓
       React dashboard
```

See `ARCHITECTURE.md`, `MIGRATION_FROM_ORIGINAL.md`, and `docs/CURRENT_STATE.md` for the audit and design decisions.

## Repository structure

```text
safevision-ai/
├── backend/                 FastAPI, SQLAlchemy, Alembic, CV worker, tests
├── frontend/                React + TypeScript + Vite + Recharts
├── ml/
│   ├── weights/ppe.pt       original uploaded model
│   ├── sample_data/         put demo videos here
│   └── evaluation/          reproducible validation script/results
├── evidence/                saved incident screenshots
├── legacy/original_project/ preserved original scripts
├── docs/CURRENT_STATE.md    audit of the uploaded project
├── SAFEVISION_BUILD_GUIDE.md
├── PROJECT_STATUS.md
├── ARCHITECTURE.md
├── MIGRATION_FROM_ORIGINAL.md
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Fastest setup path

### 1. Start PostgreSQL

```bash
docker compose up postgres -d
```

### 2. Backend

```bash
cd backend
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Then:

```bash
pip install -r requirements.txt
alembic upgrade head
python scripts/seed.py
uvicorn app.main:app --reload
```

Open API documentation: `http://localhost:8000/docs`.

### 3. Verify the uploaded model

From `backend/`:

```bash
python scripts/inspect_model.py --weights ../ml/weights/ppe.pt
```

The old script expects key labels including `Person`, `Hardhat`, `Safety Vest`, `Gloves`, `Mask`, `NO-Hardhat`, `NO-Mask`, and `NO-Safety Vest`.

### 4. Frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 5. Run SafeVision on a video

Put a video at `ml/sample_data/demo.mp4`, then from `backend/`:

```bash
python -m app.workers.video_worker --source ../ml/sample_data/demo.mp4 --camera-id 1
```

Webcam:

```bash
python -m app.workers.video_worker --source 0 --camera-id 1
```

## Important rule behavior

The original model has explicit negative classes such as `NO-Hardhat`. The upgraded app uses those as violation signals instead of assuming every missing positive detection is a real PPE violation.

The old webcam code references `NO-Gloves`, but that class is absent from its own 25-class list. Therefore glove absence inference is disabled by default. After testing, you can opt in via:

```env
ABSENCE_BASED_PPE=gloves
```

## Tests

```bash
cd backend
pytest -q
```

At package creation, the merged backend suite passed **5 tests**.

## Full Docker stack

After confirming local setup:

```bash
docker compose up --build
```

This runs PostgreSQL, FastAPI, and the React dashboard. Run the vision worker locally for webcam access, or extend Compose with a device/video-specific worker later.

## Model evaluation

You need a labelled YOLO validation dataset and its `data.yaml` before you can defend model-performance claims.

```bash
python ml/evaluation/evaluate_yolo.py \
  --weights ml/weights/ppe.pt \
  --data path/to/data.yaml \
  --out ml/evaluation/results/latest.json
```

Record precision, recall, F1, mAP50, mAP50-95, latency, and FPS. Do not rename one of these metrics to generic "accuracy" unless you define and reproduce exactly what accuracy means.

## Resume targets

Only after measurement, target bullets like:

- Built a real-time PPE compliance platform using YOLOv8, OpenCV, and ByteTrack, detecting 4 PPE compliance categories at **[measured metric]**.
- Engineered a FastAPI/PostgreSQL incident pipeline processing **[measured event count]** detection events with alerts and resolution tracking.
- Developed a React safety dashboard tracking **6+ compliance KPIs** across violations, locations, and historical trends.
- Implemented object tracking, Docker, testing, and CI, reducing duplicate alerts by **[measured %]** and enabling reproducible deployment.

The exact commands and measurement queries are in `SAFEVISION_BUILD_GUIDE.md`.
