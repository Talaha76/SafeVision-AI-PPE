# SafeVision AI — Step-by-Step Upgrade Guide

This guide is for the **actual uploaded SafeVision AI project**. It assumes you are improving the existing YOLO webcam detector, not building an unrelated project from zero.

---

# 0. What you already had

The uploaded SafeVision code already contained:

- a trained `Live Image Detection/ppe.pt` model,
- an OpenCV webcam loop,
- YOLOv8 real-time inference,
- bounding boxes and confidence labels,
- positive PPE classes such as `Gloves`, `Hardhat`, `Mask`, and `Safety Vest`,
- a `Person` class,
- explicit negative labels: `NO-Hardhat`, `NO-Mask`, and `NO-Safety Vest`,
- a README claiming approximately 94% detection accuracy.

It did **not** contain worker tracking, incident persistence, an API, PostgreSQL, a dashboard, testing, Docker, CI, or reproducible evaluation results.

The upgraded repository preserves the original scripts under `legacy/original_project/` and moves the real model to:

```text
ml/weights/ppe.pt
```

The old webcam code also checks for `NO-Gloves`, but its 25-class list has no `NO-Gloves`. Do not pretend that class exists. The new code treats glove-absence logic as opt-in.

---

# 1. Target product

The finished system should behave like this:

```text
video/webcam
   ↓
YOLOv8 detection using your ppe.pt
   ↓
ByteTrack persistent worker IDs
   ↓
associate PPE / negative PPE labels to worker
   ↓
zone requirements
   ↓
raw compliance observation
   ↓
incident cooldown / deduplication
   ↓
PostgreSQL
   ↓
FastAPI
   ↓
React dashboard + incident management + analytics
```

The final recruiter demo should show a real input video, one worker violation, one deduplicated incident, evidence, incident resolution, KPIs, and model performance.

---

# 2. Key concepts before you run anything

## YOLOv8

YOLO is the neural-network object detector. For each frame it predicts:

- class ID/name,
- confidence score,
- bounding box `(x1, y1, x2, y2)`.

Your existing model is `ppe.pt`.

## OpenCV

OpenCV reads frames from webcam/video/RTSP and can draw/save images.

## ByteTrack

ByteTrack connects detections across frames and gives a person a persistent `track_id`.

Without tracking:

```text
frame 1 -> missing hardhat
frame 2 -> missing hardhat
frame 3 -> missing hardhat
```

can look like three separate alerts.

With tracking:

```text
worker track_id=17 -> hardhat violation
```

can become one incident during a cooldown window.

## FastAPI

FastAPI is the backend web API. React asks it for incidents and analytics, and the computer-vision worker stores/retrieves data through the same application/database layer.

## PostgreSQL

PostgreSQL is the persistent relational database.

## SQLAlchemy

SQLAlchemy maps Python classes such as `Incident` to SQL database tables. This is an ORM: Object-Relational Mapper.

## Alembic

Alembic versions your database schema. Instead of manually recreating tables each time the schema changes, you create migrations.

## React

React is the browser UI. SafeVision uses TypeScript + Vite + Recharts.

## Docker

Docker makes PostgreSQL/backend/frontend environments reproducible.

## CI

GitHub Actions runs tests/build checks automatically after pushes/pull requests.

---

# 3. Install prerequisites

Recommended:

- Git
- Python 3.11 or 3.12
- Node.js 20+ / 22 LTS
- Docker Desktop
- VS Code

Verify:

```bash
git --version
python --version
node --version
npm --version
docker --version
docker compose version
```

If `python` maps to another version, Windows users may use `py -3.12`.

---

# 4. Open the upgraded repository

Unzip it and open the root folder in VS Code.

You should see:

```text
backend/
frontend/
ml/
legacy/
evidence/
docs/
docker-compose.yml
README.md
SAFEVISION_BUILD_GUIDE.md
```

Confirm the real model exists:

```text
ml/weights/ppe.pt
```

Do not replace it unless you intentionally train a newer model.

---

# 5. Preserve and understand the original project

Open:

```text
legacy/original_project/Yolo-Webcam.py
```

That script is useful for comparison because it shows the original design:

1. `cv2.VideoCapture(1)` opens a hardcoded webcam.
2. `YOLO(...)` loads the model.
3. Every frame goes through inference.
4. The script manually maps class IDs.
5. It draws bounding boxes.
6. It has no persistent incidents.

Now compare it with:

```text
backend/app/services/detector.py
backend/app/services/tracker.py
backend/app/services/rules_engine.py
backend/app/services/incident_service.py
backend/app/workers/video_worker.py
```

The upgrade turns one large loop into small testable services.

---

# 6. Set up PostgreSQL first

Start only PostgreSQL:

```bash
docker compose up postgres -d
```

Check it:

```bash
docker compose ps
```

You should see PostgreSQL as healthy/running.

Connect with `psql` inside the container:

```bash
docker compose exec postgres psql -U safevision -d safevision
```

Useful commands inside PostgreSQL:

```sql
SELECT current_database();
\dt
\q
```

At this point `\dt` may show no project tables because migrations have not run yet.

---

# 7. Backend Python environment

Open a terminal:

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

Install packages:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Important packages include:

```text
fastapi
uvicorn
SQLAlchemy
alembic
psycopg
ultralytics
opencv-python-headless
pytest
```

For local GUI experiments you can also install normal `opencv-python`; the backend uses headless OpenCV because the server itself does not need a display window.

---

# 8. Environment variables

From the project root, copy:

```text
.env.example
```

to:

```text
.env
```

For a local backend launched from `backend/`, you can also copy the same variables into `backend/.env` if desired.

Key settings:

```env
DATABASE_URL=postgresql+psycopg://safevision:safevision@localhost:5432/safevision
MODEL_PATH=../ml/weights/ppe.pt
PERSON_MODEL_PATH=
PERSON_CLASS_NAME=person
INCIDENT_COOLDOWN_SECONDS=30
ABSENCE_BASED_PPE=
```

Why is `PERSON_MODEL_PATH` blank?

Because your uploaded `ppe.pt` already has a `Person` class. The tracking service can use the same model with ByteTrack.

---

# 9. Inspect your real model

From `backend/`:

```bash
python scripts/inspect_model.py --weights ../ml/weights/ppe.pt
```

The script prints the labels embedded inside the model.

Your old Python code expects at least these relevant classes:

```text
Gloves
Hardhat
Mask
NO-Hardhat
NO-Mask
NO-Safety Vest
Person
Safety Vest
```

If the model output differs from the manual list, trust the model metadata and adjust aliases/rules accordingly.

The canonical names used internally are:

```text
Hardhat        -> hardhat
Safety Vest    -> vest
Gloves         -> gloves
Mask           -> mask
NO-Hardhat     -> no_hardhat
NO-Safety Vest -> no_vest
NO-Mask        -> no_mask
Person         -> person
```

---

# 10. Understand why the new rules engine is safer

A detector can fail to detect an object that is actually present.

Therefore this logic is risky:

```python
if "hardhat" not in detected_items:
    create_violation()
```

Your actual model helps because it includes explicit classes such as `NO-Hardhat`.

The new default is:

```text
NO-Hardhat detection -> hardhat violation
NO-Safety Vest       -> vest violation
NO-Mask              -> mask violation
```

That is more defensible than treating every missing positive box as a violation.

## Gloves issue

The old script contains a condition for `NO-Gloves`, but there is no `NO-Gloves` entry in its class list.

Therefore glove absence inference is off by default.

If testing proves that missing positive glove detections are reliable enough, enable:

```env
ABSENCE_BASED_PPE=gloves
```

If it produces false alerts, leave it disabled.

---

# 11. Create database tables with Alembic

From `backend/`:

```bash
alembic upgrade head
```

Then connect to PostgreSQL:

```bash
docker compose exec postgres psql -U safevision -d safevision
```

Run:

```sql
\dt
```

Expected project tables:

```text
sites
cameras
incidents
detection_events
compliance_observations
model_runs
```

## Table meanings

### `sites`

Physical/demo workplace sites.

### `cameras`

Camera/video sources assigned to a site and zone.

### `incidents`

Deduplicated safety cases that can be reviewed/resolved/dismissed.

### `detection_events`

Raw model detections. These are useful for volume metrics such as total processed detection events.

### `compliance_observations`

Worker/frame-level compliance outcomes. This creates a denominator for compliance rate and raw-vs-deduplicated violation calculations.

### `model_runs`

Stores evaluated model performance and runtime measurements.

---

# 12. Learn the most important SQL

Count all incidents:

```sql
SELECT COUNT(*) FROM incidents;
```

Count raw detection events:

```sql
SELECT COUNT(*) FROM detection_events;
```

Open incidents:

```sql
SELECT COUNT(*)
FROM incidents
WHERE status IN ('open', 'reviewing');
```

Violations by type:

```sql
SELECT violation_type, COUNT(*) AS incidents
FROM incidents
GROUP BY violation_type
ORDER BY incidents DESC;
```

Latest incidents:

```sql
SELECT id, camera_id, track_id, violation_type, severity, status, detected_at
FROM incidents
ORDER BY detected_at DESC
LIMIT 20;
```

These queries are useful in interviews because they show that your dashboard metrics come from a real data model.

---

# 13. Seed the database

From `backend/`:

```bash
python scripts/seed.py
```

This creates a demo site and loading-bay camera.

Check:

```sql
SELECT * FROM sites;
SELECT * FROM cameras;
```

By default the loading bay requires:

```text
hardhat + vest
```

Rules are defined in:

```text
backend/app/services/rules_engine.py
```

---

# 14. Run FastAPI

From `backend/`:

```bash
uvicorn app.main:app --reload
```

Open:

```text
http://localhost:8000/docs
```

Test:

```text
GET /api/health
```

Expected JSON:

```json
{"status":"ok"}
```

Important API endpoints:

```text
GET    /api/incidents
GET    /api/incidents/{id}
POST   /api/incidents
PATCH  /api/incidents/{id}
GET    /api/analytics/summary
GET    /api/analytics/trends
GET    /api/analytics/violations
GET    /api/analytics/sites
GET    /api/cameras
POST   /api/cameras
PATCH  /api/cameras/{id}
GET    /api/model/performance
```

---

# 15. Manually test the incident pipeline before YOLO

In Swagger (`/docs`) use `POST /api/incidents` with something like:

```json
{
  "camera_id": 1,
  "track_id": 17,
  "violation_type": "hardhat",
  "missing_ppe": ["hardhat"],
  "severity": "high",
  "confidence": 0.91
}
```

Then call:

```text
GET /api/incidents
```

This proves:

```text
FastAPI -> SQLAlchemy -> PostgreSQL
```

before you add computer-vision complexity.

Resolve it:

```text
PATCH /api/incidents/{id}
```

body:

```json
{
  "status": "resolved",
  "notes": "Demo incident reviewed"
}
```

---

# 16. Run backend tests

From `backend/`:

```bash
pytest -q
```

The packaged version passed 5 tests during the merge.

The tests currently cover:

- health endpoint,
- explicit-negative PPE rules,
- safer no-absence default,
- opt-in absence-based rules,
- duplicate incident suppression.

As you finish the project, add tests for:

- incident create/update validation,
- filters,
- analytics queries,
- severity mapping,
- evidence paths,
- camera CRUD,
- resolution timestamps.

Run coverage:

```bash
pytest --cov=app --cov-report=term-missing
```

Record actual coverage only if you want to mention it.

---

# 17. Prepare a demo video

Create:

```text
ml/sample_data/demo.mp4
```

Use footage you have rights to use and that actually shows relevant PPE states.

A good demo video includes:

- at least one person,
- visible hardhat/vest states,
- a missing hardhat or vest case your model can recognize,
- enough movement to demonstrate track IDs,
- several seconds of the same violation so deduplication is obvious.

---

# 18. Run the new vision worker

From `backend/`:

```bash
python -m app.workers.video_worker \
  --source ../ml/sample_data/demo.mp4 \
  --camera-id 1
```

Windows PowerShell can use one line:

```powershell
python -m app.workers.video_worker --source ../ml/sample_data/demo.mp4 --camera-id 1
```

For webcam:

```bash
python -m app.workers.video_worker --source 0 --camera-id 1
```

`--source 0` is configurable and replaces the original hardcoded webcam index `1`.

Test a small number of frames:

```bash
python -m app.workers.video_worker --source ../ml/sample_data/demo.mp4 --camera-id 1 --max-frames 100
```

---

# 19. What the worker does per frame

The worker:

1. gets a frame from OpenCV,
2. calls `PPEDetector.detect`,
3. calls `PersonTracker.track`,
4. receives ByteTrack `track_id`s,
5. associates detection centers to person boxes,
6. separates positive PPE from explicit negative PPE,
7. evaluates the camera zone rules,
8. stores a compliance observation,
9. stores raw detection events,
10. asks the incident service whether a violation is new,
11. creates only a deduplicated incident,
12. saves an evidence image,
13. optionally sends a webhook alert.

This is the core story you should be able to explain in an interview.

---

# 20. Understand ByteTrack and deduplication

Suppose a worker is assigned `track_id=17` and the model sees `NO-Hardhat` for 90 consecutive frames.

Raw observations may contain many violation candidates, but the incident rule uses:

```text
camera_id
+
track_id
+
violation_type
+
30 second cooldown
```

So those repeated frames can produce one incident rather than 90 alerts.

The cooldown is configured with:

```env
INCIDENT_COOLDOWN_SECONDS=30
```

Tune it on real footage.

---

# 21. Validate tracking visually

The current worker focuses on backend storage. For debugging, you can temporarily add visualization or create a dedicated debug script that draws:

- person box,
- `track_id`,
- assigned PPE,
- missing PPE.

Watch for:

- track IDs switching between people,
- PPE assigned to the wrong nearby worker,
- negative PPE boxes outside the worker box,
- crowded scenes.

The current association algorithm assigns a detection to the smallest person box containing that detection's center. This is a baseline, not a research-grade association method.

If crowded-scene performance is poor, consider:

- IoU/overlap matching,
- body-region constraints,
- pose/keypoint association,
- Hungarian assignment,
- training person-level PPE state classes.

Do not claim tracking quality you have not measured.

---

# 22. Evidence screenshots

When a new incident is created, SafeVision saves an evidence image under:

```text
evidence/
```

The incident stores the evidence path.

Verify:

1. trigger a real violation,
2. inspect the new row in `incidents`,
3. confirm an image exists,
4. open the image,
5. ensure it actually shows the relevant worker.

If evidence is wrong, fix the person association before polishing the dashboard.

---

# 23. Start the React dashboard

New terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The dashboard currently includes:

- incidents today,
- open incidents,
- compliance rate,
- top violation,
- highest-risk location,
- average resolution time,
- duplicate reduction,
- incident trend chart,
- recent incident table,
- resolve action.

That already provides 6+ KPIs, but you should polish the UX before the final demo.

---

# 24. Frontend work still worth doing

Add or improve:

- filters for status/severity/site/camera/date,
- incident detail drawer/page,
- evidence image display,
- notes editor,
- Review / Resolve / Dismiss actions,
- violation-category chart,
- site chart,
- severity chart,
- model-performance page,
- responsive mobile/tablet layout,
- loading skeletons,
- clear API error UI.

Do these after the backend/data pipeline works.

---

# 25. Calculate compliance rate correctly

Compliance needs a denominator.

That is why the upgrade adds `compliance_observations`.

Conceptually:

```text
compliance rate
=
compliant worker observations / total worker observations
```

The dashboard endpoint calculates it from real database rows.

Be able to explain that this is an observation-level metric, not necessarily a unique-worker-per-shift metric. If you later need a stronger business KPI, aggregate per track/session/time window.

---

# 26. Measure duplicate-alert reduction

The dashboard analytics service compares raw missing-PPE observations against deduplicated incidents.

Conceptually:

```text
duplicate reduction %
= (raw violation observations - unique incidents)
  / raw violation observations
  * 100
```

Query the endpoint:

```text
GET /api/analytics/summary
```

It returns fields including:

```text
raw_violation_observations
unique_incidents
duplicate_reduction_pct
```

If it reports 83.2%, you may say ~83%.

If it reports 54%, do not write 80% on your resume.

---

# 27. Generate and prove 5,000+ events

The resume goal says 5,000+ detection events.

Do not seed a fake number just for the resume.

Run real/prerecorded video, then query:

```sql
SELECT COUNT(*) FROM detection_events;
```

If the result is at least 5,000, the bullet is supported.

Also inspect what those events are:

```sql
SELECT class_name, COUNT(*)
FROM detection_events
GROUP BY class_name
ORDER BY COUNT(*) DESC;
```

This helps you explain the dataset generated by the system.

---

# 28. Reproduce the old ~94% claim

The original README says approximately 94% detection accuracy, but the upload does not include the evaluation data/calculation that proves it.

You need a labelled validation dataset.

Typically YOLO datasets have:

```text
dataset/
├── images/
│   ├── train/
│   └── val/
├── labels/
│   ├── train/
│   └── val/
└── data.yaml
```

Run:

```bash
python ml/evaluation/evaluate_yolo.py \
  --weights ml/weights/ppe.pt \
  --data path/to/data.yaml \
  --out ml/evaluation/results/latest.json
```

The script stores:

```text
precision
recall
F1
mAP50
mAP50-95
average inference latency
FPS estimate
```

Use the correct metric name on your resume.

Examples:

Good:

```text
4 PPE categories at 94% precision
```

Good if supported:

```text
mAP@50 of 0.94 on a held-out PPE validation set
```

Bad unless clearly defined:

```text
94% accuracy
```

---

# 29. Measure latency and FPS

Your evaluation JSON includes inference timing when available.

Also test the full live pipeline because detector-only FPS is not the same as application FPS.

Record:

- hardware,
- video resolution,
- model,
- detector latency,
- tracker overhead,
- approximate full-pipeline FPS.

If an interviewer asks "94% on what hardware/data?", you should have a precise answer.

---

# 30. Model performance API

The backend has:

```text
GET /api/model/performance
```

Use:

```text
backend/scripts/import_model_metrics.py
```

to load evaluated results into `model_runs` after you generate a real evaluation JSON.

Do not populate the database with made-up metrics.

---

# 31. Alerts

The project includes optional webhook alert support.

Configure:

```env
ALERT_WEBHOOK_URL=https://...
```

The key engineering rule is:

```text
alert only after incident deduplication
```

not once per raw frame.

For a portfolio demo, a simple webhook/demo notification is sufficient. You do not need enterprise notification infrastructure.

---

# 32. Docker

After local services work:

```bash
docker compose up --build
```

Services:

```text
postgres
backend
frontend
```

The backend container mounts:

```text
./ml/weights -> /models
./evidence   -> /app/evidence
```

and uses:

```text
/models/ppe.pt
```

For webcam processing, it is usually easier to run the vision worker from the host because camera-device passthrough differs by OS. Docker still gives you reproducible backend/frontend/database deployment.

---

# 33. Docker verification checklist

Run:

```bash
docker compose up --build
```

Then verify:

```text
http://localhost:8000/api/health
http://localhost:8000/docs
http://localhost:5173
```

Seed inside Docker:

```bash
docker compose exec backend python scripts/seed.py
```

If migrations are not automatically run by your preferred workflow, run:

```bash
docker compose exec backend alembic upgrade head
```

Check logs:

```bash
docker compose logs backend
```

---

# 34. GitHub Actions CI

Push the repository to GitHub.

The workflow is:

```text
.github/workflows/ci.yml
```

The goal is:

```text
backend dependencies
  ↓
pytest
  ↓
frontend dependencies
  ↓
frontend production build
```

Only use the phrase **CI/CD** if you also add an automated deployment step. Otherwise **CI** is more precise.

---

# 35. Git workflow

Good milestone commits:

```text
chore: preserve original SafeVision project
refactor: extract YOLO PPE detector service
feat: add ByteTrack worker tracking
feat: add PPE rules and incident deduplication
feat: add PostgreSQL incident persistence
feat: expose FastAPI incident and analytics endpoints
feat: add React safety dashboard
feat: add model evaluation tooling
chore: dockerize full stack
ci: add backend and frontend checks
```

This gives recruiters a believable development history.

---

# 36. Add demo data

A recruiter should not need your physical webcam.

Include or document:

```text
ml/sample_data/demo.mp4
```

If the video is too large or you cannot redistribute it, put download/source instructions in the README and keep a small sample if licensing permits.

Also consider a seed/demo script for database-only UI demonstrations.

---

# 37. Final 3-minute demo flow

Aim for:

1. open React dashboard,
2. show current KPIs,
3. start prerecorded PPE video,
4. show a worker ID persist across frames,
5. trigger `NO-Hardhat`/other violation,
6. show only one incident despite repeated frames,
7. open/show evidence,
8. resolve incident,
9. show KPI/trend change,
10. show model performance page/JSON,
11. briefly show Docker/CI.

Do not spend most of the demo scrolling code.

---

# 38. Resume measurement worksheet

Before writing final bullets, fill this from real outputs:

```text
Model file/version: ______________________
Validation dataset: ______________________
PPE categories highlighted: ______________
Precision: _______________________________
Recall: __________________________________
F1: ______________________________________
mAP50: ___________________________________
mAP50-95: ________________________________
Inference latency: ________________________
FPS: _____________________________________
Detection event count: ____________________
Unique incident count: ____________________
Duplicate reduction: ______________________
Dashboard KPI count: ______________________
Backend test count: _______________________
Test coverage: ____________________________
CI status: ________________________________
```

---

# 39. Target resume bullets after measurement

Do not paste these unchanged until the brackets are replaced with measured numbers.

```text
SafeVision AI – Computer Vision Monitoring | Python, YOLOv8, OpenCV, FastAPI, PostgreSQL, React

• Built a real-time PPE compliance platform using YOLOv8, OpenCV, and ByteTrack, detecting 4 PPE categories at [measured precision/mAP].
• Engineered a FastAPI/PostgreSQL incident pipeline processing [measured count]+ detection events with alerts and resolution tracking.
• Developed a React safety dashboard tracking 6+ compliance KPIs across violations, locations, and historical trends.
• Implemented object tracking, Docker, testing, and CI, reducing duplicate alerts by [measured %] and enabling reproducible deployment.
```

If the final measurement is genuinely 94% and your chosen metric is defensible, write the metric explicitly, for example `94% precision` rather than vague `94% accuracy`.

---

# 40. Interview concepts you should be able to explain

## Why ByteTrack?

Because frame-level object detections do not identify the same worker across time; persistent IDs are required for incident deduplication and worker-session analytics.

## Why PostgreSQL?

Because incidents, cameras, sites, state transitions, and metrics are structured relational data that should persist independently of the vision process.

## Why FastAPI?

It separates the computer-vision/data layer from the web UI and gives typed validation/documented HTTP endpoints.

## Why Alembic?

It versions schema changes so teammates/deployments can reproduce the same database state.

## Why not create an incident every frame?

That creates alert floods. The system uses tracking + cooldown deduplication.

## Why explicit `NO-Hardhat` classes?

A missing positive detection can be a model false negative. An explicit violation class gives a direct learned signal, although it still must be validated.

## Why store raw detection events as well as incidents?

Incidents are deduplicated business events; raw detections are useful for volume analysis, debugging, and measuring how much alert noise deduplication removed.

## Why keep evaluation separate from the live dashboard?

Offline validation measures model quality against labels. Live production metrics measure runtime/operational behavior. They answer different questions.

---

# 41. Recommended order from here

Do these in this exact order:

```text
1. Install dependencies
2. Inspect ppe.pt labels
3. Start PostgreSQL
4. Run Alembic
5. Seed site/camera
6. Start FastAPI
7. Manually create/read/resolve incident
8. Run pytest
9. Start React
10. Add demo video
11. Run vision worker for 100 frames
12. Inspect DB events/incidents/evidence
13. Validate ByteTrack visually
14. Tune association + cooldown
15. Enable glove absence only if defensible
16. Run longer video and collect real metrics
17. Build validation dataset / locate original validation split
18. Run model evaluation
19. Import model metrics
20. Polish dashboard
21. Verify Docker
22. Push GitHub / verify CI
23. Record demo
24. Update README screenshots
25. Replace resume placeholders with measured numbers
```

---

# 42. Definition of done

## Computer vision

- [ ] `ppe.pt` loads successfully
- [ ] embedded classes verified
- [ ] video/webcam inference works
- [ ] Person ByteTrack IDs are stable enough for demo footage
- [ ] PPE/negative labels associate to the correct worker
- [ ] explicit violation labels produce correct incidents
- [ ] glove behavior is intentionally configured and tested

## Backend/database

- [ ] PostgreSQL starts
- [ ] Alembic migration works from a blank DB
- [ ] seed script works
- [ ] incidents persist
- [ ] deduplication works
- [ ] evidence saves
- [ ] API filters/updates work
- [ ] analytics come from real DB data

## Frontend

- [ ] dashboard loads real API data
- [ ] 6+ KPIs shown
- [ ] trend/category/location analytics shown
- [ ] incident lifecycle works
- [ ] evidence visible
- [ ] loading/error states work
- [ ] responsive enough for demo

## ML credibility

- [ ] labelled validation set identified
- [ ] precision measured
- [ ] recall measured
- [ ] F1 measured
- [ ] mAP50 measured
- [ ] mAP50-95 measured
- [ ] latency measured
- [ ] FPS measured
- [ ] original ~94% claim reproduced or removed/reworded

## Engineering

- [ ] pytest passes
- [ ] meaningful test coverage recorded
- [ ] Docker Compose starts stack
- [ ] GitHub Actions passes
- [ ] README contains screenshots/demo
- [ ] no secrets committed
- [ ] measured metrics replace resume placeholders

When every relevant box is checked, SafeVision has moved from a webcam YOLO demo to a defensible portfolio-grade PPE intelligence platform.
