# Current State Audit — Uploaded SafeVision AI

## Source inspected

Uploaded archive: `SafeVision-AI---PPE-Detection--main (1).zip`.

The SafeVision folder contained:

- `Live Image Detection/ppe.pt` — existing trained model (~6 MB)
- `Live Image Detection/Yolo-Webcam.py` — current webcam detector
- `Stationary Image Detection/Yolo-Basics.py` — generic stationary image YOLO example
- `requirements.txt`
- `README.md`
- `main.py` — only prints `Hello World`

The archive also contained an unrelated Customer Feedback ETL ZIP. It is not part of this deliverable.

## Existing detection behavior

The webcam script:

1. opens webcam device index `1`,
2. loads `ppe.pt`,
3. runs YOLO inference frame-by-frame,
4. draws bounding boxes and confidence labels,
5. colors positive PPE green and explicit negative PPE red.

Its manual class list contains 25 labels:

`Excavator`, `Gloves`, `Hardhat`, `Ladder`, `Mask`, `NO-Hardhat`, `NO-Mask`, `NO-Safety Vest`, `Person`, `SUV`, `Safety Cone`, `Safety Vest`, `bus`, `dump truck`, `fire hydrant`, `machinery`, `mini-van`, `sedan`, `semi`, `trailer`, `truck and trailer`, `truck`, `van`, `vehicle`, `wheel loader`.

## Important issues found

- The old script contains `NO-Gloves` logic, but `NO-Gloves` is not present in the 25-class list.
- Model path and webcam device are hardcoded.
- The model is loaded directly in the script rather than through a reusable service.
- No worker tracking or persistent IDs exist.
- Every frame is independent, so there is no incident deduplication.
- No database/API/dashboard exists.
- The README states ~94% "accuracy" but the uploaded project does not include an evaluation dataset or reproducible metric output showing how that number was calculated.
- `main.py` is not an application entry point yet.

## Upgrade strategy

Preserve the trained model and original scripts, then add maintainable services around them: tracking, compliance rules, deduplication, PostgreSQL, FastAPI, React, evaluation, tests, Docker, and CI.
