# ============================================================
# SAFEVISION AI — MODEL INSPECTION
# ============================================================
#
# Loads a YOLO model, lists its embedded classes, and checks
# whether the expected SafeVision PPE labels are present.
#
# ============================================================

import argparse
from ultralytics import YOLO

EXPECTED_ORIGINAL_LABELS = {
    "Gloves", "Hardhat", "Mask", "NO-Hardhat", "NO-Mask",
    "NO-Safety Vest", "Person", "Safety Vest"
}

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Inspect the classes embedded in a YOLO model")
    p.add_argument("--weights", default="../ml/weights/ppe.pt")
    args = p.parse_args()
    model = YOLO(args.weights)
    names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
    print("Supported classes:")
    for class_id, name in names.items():
        print(f"{class_id}: {name}")
    found = {str(v) for v in names.values()}
    print("\nExpected labels from the original SafeVision script:")
    for label in sorted(EXPECTED_ORIGINAL_LABELS):
        print(f"{'OK' if label in found else 'MISSING'}  {label}")
