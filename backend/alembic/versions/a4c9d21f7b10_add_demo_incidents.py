"""add permanent demo incident flag

Revision ID: a4c9d21f7b10
Revises: efd6bb43d969
"""

from alembic import op
import sqlalchemy as sa


revision = "a4c9d21f7b10"
down_revision = "efd6bb43d969"

branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "incidents",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.create_index(
        "ix_incidents_is_demo",
        "incidents",
        [
            "is_demo",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_incidents_is_demo",
        table_name="incidents",
    )

    op.drop_column(
        "incidents",
        "is_demo",
    )