# ============================================================
# SAFEVISION AI — DATABASE BASE
# ============================================================
#
# Defines the shared SQLAlchemy base class used by all
# database models in the application.
#
# ============================================================

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
