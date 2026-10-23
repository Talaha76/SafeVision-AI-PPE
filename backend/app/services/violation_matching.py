# ============================================================
# SAFEVISION AI — VIOLATION MATCHING
# ============================================================
#
# Matches missing PPE rules with the corresponding explicit
# negative detection and selects the strongest match.
#
# ============================================================

def normalize_class_name(
    name: str,
) -> str:
    return (
        name
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


NEGATIVE_CLASS_BY_PPE = {
    "hardhat": {
        "no_hardhat",
    },

    "mask": {
        "no_mask",
    },

    "vest": {
        "no_safety_vest",
        "no_vest",
    },

    "safety_vest": {
        "no_safety_vest",
        "no_vest",
    },

    # Your current model does not actually
    # contain NO-Gloves, but this is here in
    # case a future model does.
    "gloves": {
        "no_gloves",
    },
}


def find_violation_detection(
    person_detections,
    missing_item: str,
):
    """
    Return the highest-confidence explicit
    negative PPE detection matching a rule
    violation.

    Example:
        missing_item = "hardhat"
        detector class = "NO-Hardhat"
    """

    normalized_item = (
        normalize_class_name(
            missing_item
        )
    )

    targets = (
        NEGATIVE_CLASS_BY_PPE.get(
            normalized_item,
            {
                f"no_{normalized_item}",
            },
        )
    )

    matches = [
        detection
        for detection
        in person_detections

        if normalize_class_name(
            detection.class_name
        )
        in targets
    ]

    if not matches:
        return None

    return max(
        matches,
        key=lambda detection:
            detection.confidence,
    )