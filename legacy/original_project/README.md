# Original SafeVision AI snapshot

This folder preserves the Python files from the uploaded SafeVision AI project so you can compare the original webcam demo with the upgraded platform.

Only one functional path was changed in `Yolo-Webcam.py`: the model now loads from `../../ml/weights/ppe.pt` so the 6 MB model does not need to be duplicated in the ZIP.

The uploaded archive also contained an unrelated `Customer-Feedback-ETL-Pipeline-main (1).zip`. It was intentionally excluded from the SafeVision deliverable because it is not part of this project.
