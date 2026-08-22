"""Add plate history search type.

Revision ID: 20260820_0003
Revises: 20260820_0002
"""

from alembic import op

revision = "20260820_0003"
down_revision = "20260820_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE search_type ADD VALUE IF NOT EXISTS 'PLATE_HISTORY'")


def downgrade() -> None:
    op.execute("DELETE FROM search_history WHERE search_type = 'PLATE_HISTORY'")
    op.execute(
        "ALTER TABLE search_history ALTER COLUMN search_type TYPE VARCHAR(32) "
        "USING search_type::text"
    )
    op.execute("DROP TYPE search_type")
    op.execute("CREATE TYPE search_type AS ENUM ('PLATE', 'VIN', 'INSURANCE')")
    op.execute(
        "ALTER TABLE search_history ALTER COLUMN search_type TYPE search_type "
        "USING search_type::text::search_type"
    )
