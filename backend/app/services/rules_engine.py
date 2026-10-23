# ============================================================
# SAFEVISION AI — PPE RULES ENGINE
# ============================================================
#
# Evaluates PPE compliance, normalizes PPE labels, determines
# missing equipment, and assigns incident severity.
#
# ============================================================

from dataclasses import dataclass


# ============================================================
# GLOBAL PPE POLICY
# ============================================================
#
# SafeVision no longer uses different PPE requirements
# depending on a zone.
#
# Every tracked person is checked against all four PPE items.
# ============================================================

REQUIRED_PPE = {
    "hardhat",
    "vest",
    "mask",
    "gloves",
}


SEVERITY_BY_PPE = {
    "hardhat": "high",
    "vest": "high",
    "mask": "medium",
    "gloves": "medium",
}


SEVERITY_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
}


@dataclass(frozen=True)
class RuleResult:
    compliant: bool

    required_ppe: list[str]

    missing_ppe: list[str]

    severity: str


def normalize_name(
    value: str,
) -> str:
    """
    Normalize YOLO class names and PPE names.

    Examples:

    Safety Vest
        -> safety_vest

    NO-Safety Vest
        -> no_safety_vest

    NO-Hardhat
        -> no_hardhat
    """

    return (
        value
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def positive_ppe_name(
    class_name: str,
) -> str | None:
    """
    Convert positive YOLO PPE classes into
    SafeVision's canonical PPE names.
    """

    name = normalize_name(
        class_name
    )

    mapping = {
        "hardhat": "hardhat",

        "safety_vest": "vest",
        "vest": "vest",

        "mask": "mask",

        "gloves": "gloves",
    }

    return mapping.get(name)


def negative_ppe_name(
    class_name: str,
) -> str | None:
    """
    Convert explicit negative YOLO classes
    into SafeVision PPE names.
    """

    name = normalize_name(
        class_name
    )

    mapping = {
        "no_hardhat": "hardhat",

        "no_safety_vest": "vest",
        "no_vest": "vest",

        "no_mask": "mask",

        # This mapping is ready for a future
        # retrained model containing NO-Gloves.
        "no_gloves": "gloves",
    }

    return mapping.get(name)


def _highest_severity(
    missing_ppe: list[str],
) -> str:
    """
    Return the highest severity among all
    missing PPE items.
    """

    if not missing_ppe:
        return "low"

    return max(
        (
            SEVERITY_BY_PPE.get(
                item,
                "low",
            )
            for item in missing_ppe
        ),
        key=lambda severity:
            SEVERITY_RANK[
                severity
            ],
    )


def evaluate_ppe(
    zone: str,
    present: set[str],
    *,
    explicit_negative_classes: set[str] | None = None,
    absence_based_items: set[str] | None = None,
) -> RuleResult:
    """
    Evaluate global PPE compliance.

    The `zone` argument remains in the function
    signature so the existing Live Detection and
    video worker code do not need to change.

    It is intentionally ignored.

    Required PPE for EVERY person:

        - hardhat
        - vest
        - mask
        - gloves

    Explicit negative detector classes are trusted.

    Missing gloves can optionally be inferred when
    Gloves is not detected, because the current
    model does not contain a NO-Gloves class.
    """

    # Zone is intentionally unused.
    _ = zone

    explicit_negative_classes = (
        explicit_negative_classes
        or set()
    )

    absence_based_items = (
        absence_based_items
        or set()
    )


    # ========================================================
    # POSITIVE PPE OBSERVATIONS
    # ========================================================

    present_ppe: set[str] = set()

    for class_name in present:

        ppe = positive_ppe_name(
            class_name
        )

        if ppe is not None:
            present_ppe.add(ppe)


    # ========================================================
    # EXPLICIT NEGATIVE PPE OBSERVATIONS
    # ========================================================

    missing: set[str] = set()

    for class_name in (
        explicit_negative_classes
    ):

        ppe = negative_ppe_name(
            class_name
        )

        if (
            ppe is not None
            and
            ppe in REQUIRED_PPE
        ):
            missing.add(ppe)


    # ========================================================
    # ABSENCE-BASED PPE
    # ========================================================
    #
    # We use this mainly for gloves.
    #
    # Current ppe.pt:
    #
    # Gloves     -> exists
    # NO-Gloves  -> DOES NOT exist
    #
    # Therefore, if gloves are configured as
    # absence-based and Gloves is not detected,
    # SafeVision creates a missing-gloves
    # violation.
    # ========================================================

    normalized_absence_items = {
        (
            "vest"
            if normalize_name(item)
            in {
                "vest",
                "safety_vest",
            }
            else normalize_name(item)
        )

        for item
        in absence_based_items
    }


    for item in (
        REQUIRED_PPE
    ):

        if (
            item
            in normalized_absence_items
            and
            item not in present_ppe
        ):
            missing.add(item)


    missing_list = sorted(
        missing
    )


    return RuleResult(
        compliant=(
            len(missing_list) == 0
        ),

        required_ppe=sorted(
            REQUIRED_PPE
        ),

        missing_ppe=(
            missing_list
        ),

        severity=(
            _highest_severity(
                missing_list
            )
        ),
    )