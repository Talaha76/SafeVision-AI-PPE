# ============================================================
# SAFEVISION AI — TEST CONFIGURATION
# ============================================================
#
# Configures the test environment to use an in-memory SQLite
# database and prepares backend imports for automated tests.
#
# ============================================================

import os
import sys
from pathlib import Path

# Unit/API tests should not require a running PostgreSQL server. Production and
# Docker still use PostgreSQL; tests use SQLite unless explicitly overridden.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("EVIDENCE_DIR", "/tmp/safevision-test-evidence")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
