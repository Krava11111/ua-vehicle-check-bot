"""Initial production schema.

Revision ID: 20260819_0001
Revises:
"""

import sqlalchemy as sa

from alembic import op

revision = "20260819_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_errors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_errors_created_at", "application_errors", ["created_at"])
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("source_name", sa.String(255), nullable=False),
        sa.Column("version", sa.String(100), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("import_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("import_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records_total", sa.Integer(), nullable=False),
        sa.Column("records_added", sa.Integer(), nullable=False),
        sa.Column("records_updated", sa.Integer(), nullable=False),
        sa.Column("records_skipped", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "IMPORTING",
                "COMPLETED",
                "FAILED",
                "REQUIRES_REVIEW",
                name="dataset_status",
            ),
            nullable=False,
        ),
        sa.Column("checksum", sa.String(64), nullable=True),
        sa.Column("schema_signature", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("checksum"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("language", sa.String(5), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_blocked", sa.Boolean(), nullable=False),
        sa.Column("report_balance", sa.Integer(), nullable=False),
        sa.Column("subscription_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_active_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"], unique=True)
    op.create_table(
        "vehicles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_vehicle_id", sa.String(255), nullable=True),
        sa.Column("vin", sa.String(32), nullable=True),
        sa.Column("normalized_vin", sa.String(17), nullable=True),
        sa.Column("current_plate", sa.String(32), nullable=True),
        sa.Column("normalized_plate", sa.String(16), nullable=True),
        sa.Column("brand", sa.String(255), nullable=True),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("color", sa.String(100), nullable=True),
        sa.Column("vehicle_type", sa.String(255), nullable=True),
        sa.Column("body_type", sa.String(255), nullable=True),
        sa.Column("purpose", sa.String(255), nullable=True),
        sa.Column("fuel_type", sa.String(100), nullable=True),
        sa.Column("engine_capacity", sa.Integer(), nullable=True),
        sa.Column("own_weight", sa.Integer(), nullable=True),
        sa.Column("total_weight", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("data_source", sa.String(255), nullable=False),
        sa.Column("dataset_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, column in (
        ("ix_vehicles_brand", "brand"),
        ("ix_vehicles_model", "model"),
        ("ix_vehicles_normalized_plate", "normalized_plate"),
        ("ix_vehicles_normalized_vin", "normalized_vin"),
        ("ix_vehicles_source_vehicle_id", "source_vehicle_id"),
    ):
        op.create_index(name, "vehicles", [column])
    op.create_table(
        "purchases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("feature", sa.String(50), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_id"),
    )
    op.create_index("ix_purchases_user_id", "purchases", ["user_id"])
    op.create_table(
        "registration_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("vin", sa.String(17), nullable=True),
        sa.Column("plate", sa.String(32), nullable=True),
        sa.Column("normalized_plate", sa.String(16), nullable=True),
        sa.Column("registration_date", sa.Date(), nullable=True),
        sa.Column("operation_code", sa.String(50), nullable=True),
        sa.Column("operation_name", sa.Text(), nullable=True),
        sa.Column("region", sa.String(255), nullable=True),
        sa.Column("service_center", sa.String(255), nullable=True),
        sa.Column("owner_type", sa.String(50), nullable=True),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("dataset_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint", name="uq_registration_event_fingerprint"),
    )
    op.create_index("ix_events_normalized_plate", "registration_events", ["normalized_plate"])
    op.create_index("ix_events_operation_code", "registration_events", ["operation_code"])
    op.create_index("ix_events_registration_date", "registration_events", ["registration_date"])
    op.create_index(
        "ix_events_vehicle_date", "registration_events", ["vehicle_id", "registration_date"]
    )
    op.create_index("ix_events_vin", "registration_events", ["vin"])
    op.create_table(
        "search_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "search_type", sa.Enum("PLATE", "VIN", "INSURANCE", name="search_type"), nullable=False
        ),
        sa.Column("query_hash", sa.String(64), nullable=False),
        sa.Column("query_hint", sa.String(32), nullable=True),
        sa.Column("vehicle_id", sa.Integer(), nullable=True),
        sa.Column("found", sa.Boolean(), nullable=False),
        sa.Column("result_label", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_search_history_query_hash", "search_history", ["query_hash"])
    op.create_index("ix_search_user_created", "search_history", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_search_user_created", table_name="search_history")
    op.drop_index("ix_search_history_query_hash", table_name="search_history")
    op.drop_table("search_history")
    sa.Enum("PLATE", "VIN", "INSURANCE", name="search_type").drop(op.get_bind(), checkfirst=True)
    for name in (
        "ix_events_vin",
        "ix_events_vehicle_date",
        "ix_events_registration_date",
        "ix_events_operation_code",
        "ix_events_normalized_plate",
    ):
        op.drop_index(name, table_name="registration_events")
    op.drop_table("registration_events")
    op.drop_index("ix_purchases_user_id", table_name="purchases")
    op.drop_table("purchases")
    for name in (
        "ix_vehicles_source_vehicle_id",
        "ix_vehicles_normalized_vin",
        "ix_vehicles_normalized_plate",
        "ix_vehicles_model",
        "ix_vehicles_brand",
    ):
        op.drop_index(name, table_name="vehicles")
    op.drop_table("vehicles")
    op.drop_index("ix_users_telegram_id", table_name="users")
    op.drop_table("users")
    op.drop_table("datasets")
    sa.Enum(
        "PENDING",
        "IMPORTING",
        "COMPLETED",
        "FAILED",
        "REQUIRES_REVIEW",
        name="dataset_status",
    ).drop(op.get_bind(), checkfirst=True)
    op.drop_index("ix_application_errors_created_at", table_name="application_errors")
    op.drop_table("application_errors")
