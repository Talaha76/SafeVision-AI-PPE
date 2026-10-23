# ============================================================
# SAFEVISION AI — RULES ENGINE TESTS
# ============================================================
#
# Verifies PPE rule evaluation, explicit violation detection,
# severity assignment, and optional absence-based logic.
#
# ============================================================

from app.services.rules_engine import evaluate_ppe


def test_loading_bay_uses_explicit_no_hardhat_signal():
    result = evaluate_ppe(
        "loading_bay",
        {"vest"},
        explicit_negative_classes={"no_hardhat"},
    )
    assert result.missing_ppe == ["hardhat"]
    assert result.severity == "high"
    assert result.compliant is False


def test_missing_positive_detection_is_not_automatically_a_violation():
    # Safer default for object detection: absence of a hardhat box is not proof
    # that the worker has no hardhat unless absence-based logic is explicitly enabled.
    result = evaluate_ppe("loading_bay", {"vest"})
    assert result.missing_ppe == []
    assert result.compliant is True


def test_absence_based_item_is_opt_in():
    result = evaluate_ppe(
        "assembly",
        {"vest"},
        absence_based_items={"gloves"},
    )
    assert result.missing_ppe == ["gloves"]
