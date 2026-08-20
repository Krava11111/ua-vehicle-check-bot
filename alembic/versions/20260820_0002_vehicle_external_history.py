"""Add marketplace, auction and mileage history.

Revision ID: 20260820_0002
Revises: 20260819_0001
"""

import sqlalchemy as sa

from alembic import op

revision = "20260820_0002"
down_revision = "20260819_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marketplace_listings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="SET NULL")),
        sa.Column("vin", sa.String(32)),
        sa.Column("normalized_vin", sa.String(17), nullable=False),
        sa.Column("url", sa.Text()), sa.Column("title", sa.String(500)),
        sa.Column("brand", sa.String(255)), sa.Column("normalized_brand", sa.String(255)),
        sa.Column("model", sa.String(255)), sa.Column("normalized_model", sa.String(255)),
        sa.Column("year", sa.Integer()), sa.Column("price", sa.Numeric(14, 2)),
        sa.Column("currency", sa.String(3)), sa.Column("mileage", sa.Integer()),
        sa.Column("mileage_unit", sa.String(10)), sa.Column("normalized_mileage_km", sa.Integer()),
        sa.Column("city", sa.String(255)), sa.Column("region", sa.String(255)),
        sa.Column("description_hash", sa.String(64)), sa.Column("seller_type", sa.String(50)),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("provider", "external_id", name="uq_marketplace_provider_external"),
    )
    op.create_index("ix_marketplace_vin_seen", "marketplace_listings", ["normalized_vin", "last_seen_at"])
    op.create_index("ix_marketplace_vehicle_seen", "marketplace_listings", ["vehicle_id", "last_seen_at"])
    op.create_table(
        "marketplace_listing_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("listing_id", sa.Integer(), sa.ForeignKey("marketplace_listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("price", sa.Numeric(14, 2)), sa.Column("currency", sa.String(3)),
        sa.Column("mileage", sa.Integer()), sa.Column("mileage_unit", sa.String(10)),
        sa.Column("normalized_mileage_km", sa.Integer()), sa.Column("description_hash", sa.String(64)),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_listing_snapshot_observed", "marketplace_listing_snapshots", ["listing_id", "observed_at"])
    op.create_table(
        "auction_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="SET NULL")),
        sa.Column("vin", sa.String(32)), sa.Column("normalized_vin", sa.String(17), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False), sa.Column("auction_name", sa.String(100)),
        sa.Column("lot_number", sa.String(100)), sa.Column("auction_date", sa.DateTime(timezone=True)),
        sa.Column("location", sa.String(255)), sa.Column("seller_type", sa.String(100)),
        sa.Column("sale_status", sa.String(100)), sa.Column("final_bid", sa.Numeric(14, 2)),
        sa.Column("currency", sa.String(3)), sa.Column("estimated_retail_value", sa.Numeric(14, 2)),
        sa.Column("repair_cost", sa.Numeric(14, 2)), sa.Column("primary_damage", sa.String(255)),
        sa.Column("secondary_damage", sa.String(255)), sa.Column("odometer", sa.Integer()),
        sa.Column("odometer_unit", sa.String(10)), sa.Column("normalized_odometer_km", sa.Integer()),
        sa.Column("odometer_status", sa.String(100)), sa.Column("title_type", sa.String(255)),
        sa.Column("keys_available", sa.Boolean()), sa.Column("run_and_drive", sa.Boolean()),
        sa.Column("engine_starts", sa.Boolean()), sa.Column("source_url", sa.Text()),
        sa.Column("external_id", sa.String(255), nullable=False), sa.Column("brand", sa.String(255)),
        sa.Column("normalized_brand", sa.String(255)), sa.Column("model", sa.String(255)),
        sa.Column("normalized_model", sa.String(255)), sa.Column("year", sa.Integer()),
        sa.Column("color", sa.String(100)), sa.Column("engine_capacity", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("provider", "external_id", name="uq_auction_provider_external"),
    )
    op.create_index("ix_auction_vin_date", "auction_events", ["normalized_vin", "auction_date"])
    op.create_index("ix_auction_vehicle_date", "auction_events", ["vehicle_id", "auction_date"])
    op.create_table(
        "auction_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auction_event_id", sa.Integer(), sa.ForeignKey("auction_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False), sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("auction_event_id", "source_url", name="uq_auction_photo_url"),
    )
    op.create_index("ix_auction_photos_event", "auction_photos", ["auction_event_id"])
    op.create_table(
        "mileage_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="SET NULL")),
        sa.Column("normalized_vin", sa.String(17), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_mileage", sa.Integer(), nullable=False), sa.Column("original_unit", sa.String(10), nullable=False),
        sa.Column("normalized_mileage_km", sa.Integer(), nullable=False), sa.Column("source", sa.String(100), nullable=False),
        sa.Column("source_reference", sa.String(255)), sa.Column("source_url", sa.Text()),
        sa.Column("confidence", sa.String(10), nullable=False), sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("fingerprint", name="uq_mileage_record_fingerprint"),
    )
    op.create_index("ix_mileage_vin_date", "mileage_records", ["normalized_vin", "observed_at"])
    op.create_index("ix_mileage_vehicle_date", "mileage_records", ["vehicle_id", "observed_at"])
    op.create_table(
        "provider_usage_daily",
        sa.Column("id", sa.Integer(), primary_key=True), sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("date", sa.Date(), nullable=False), sa.Column("requests_count", sa.Integer(), nullable=False),
        sa.Column("cache_hits", sa.Integer(), nullable=False), sa.Column("cache_misses", sa.Integer(), nullable=False),
        sa.Column("successful_requests", sa.Integer(), nullable=False), sa.Column("failed_requests", sa.Integer(), nullable=False),
        sa.Column("estimated_cost", sa.Numeric(14, 4), nullable=False),
        sa.UniqueConstraint("provider", "date", name="uq_provider_usage_date"),
    )


def downgrade() -> None:
    op.drop_table("provider_usage_daily")
    op.drop_index("ix_mileage_vehicle_date", table_name="mileage_records")
    op.drop_index("ix_mileage_vin_date", table_name="mileage_records")
    op.drop_table("mileage_records")
    op.drop_index("ix_auction_photos_event", table_name="auction_photos")
    op.drop_table("auction_photos")
    op.drop_index("ix_auction_vehicle_date", table_name="auction_events")
    op.drop_index("ix_auction_vin_date", table_name="auction_events")
    op.drop_table("auction_events")
    op.drop_index("ix_listing_snapshot_observed", table_name="marketplace_listing_snapshots")
    op.drop_table("marketplace_listing_snapshots")
    op.drop_index("ix_marketplace_vehicle_seen", table_name="marketplace_listings")
    op.drop_index("ix_marketplace_vin_seen", table_name="marketplace_listings")
    op.drop_table("marketplace_listings")
