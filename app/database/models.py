from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SearchType(StrEnum):
    PLATE = "PLATE"
    VIN = "VIN"
    INSURANCE = "INSURANCE"
    PLATE_HISTORY = "PLATE_HISTORY"


class DatasetStatus(StrEnum):
    PENDING = "PENDING"
    IMPORTING = "IMPORTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REQUIRES_REVIEW = "REQUIRES_REVIEW"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(255))
    language: Mapped[str] = mapped_column(String(5), default="uk")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    report_balance: Mapped[int] = mapped_column(Integer, default=0)
    subscription_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    searches: Mapped[list[SearchHistory]] = relationship(back_populates="user")


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        Index("ix_vehicles_normalized_plate", "normalized_plate"),
        Index("ix_vehicles_normalized_vin", "normalized_vin"),
        Index("ix_vehicles_brand", "brand"),
        Index("ix_vehicles_model", "model"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    source_vehicle_id: Mapped[str | None] = mapped_column(String(255), index=True)
    vin: Mapped[str | None] = mapped_column(String(32))
    normalized_vin: Mapped[str | None] = mapped_column(String(17))
    current_plate: Mapped[str | None] = mapped_column(String(32))
    normalized_plate: Mapped[str | None] = mapped_column(String(16))
    brand: Mapped[str | None] = mapped_column(String(255))
    model: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str | None] = mapped_column(String(100))
    vehicle_type: Mapped[str | None] = mapped_column(String(255))
    body_type: Mapped[str | None] = mapped_column(String(255))
    purpose: Mapped[str | None] = mapped_column(String(255))
    fuel_type: Mapped[str | None] = mapped_column(String(100))
    engine_capacity: Mapped[int | None] = mapped_column(Integer)
    own_weight: Mapped[int | None] = mapped_column(Integer)
    total_weight: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    data_source: Mapped[str] = mapped_column(String(255), default="unknown")
    dataset_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    events: Mapped[list[RegistrationEvent]] = relationship(
        back_populates="vehicle",
        cascade="all, delete-orphan",
        order_by="RegistrationEvent.registration_date",
    )
    marketplace_listings: Mapped[list[MarketplaceListing]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    auction_events: Mapped[list[AuctionEvent]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    mileage_records: Mapped[list[MileageRecord]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )


class RegistrationEvent(Base):
    __tablename__ = "registration_events"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_registration_event_fingerprint"),
        Index("ix_events_registration_date", "registration_date"),
        Index("ix_events_vehicle_date", "vehicle_id", "registration_date"),
        Index("ix_events_operation_code", "operation_code"),
        Index("ix_events_normalized_plate", "normalized_plate"),
        Index("ix_events_vin", "vin"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    vin: Mapped[str | None] = mapped_column(String(17))
    plate: Mapped[str | None] = mapped_column(String(32))
    normalized_plate: Mapped[str | None] = mapped_column(String(16))
    registration_date: Mapped[date | None] = mapped_column(Date)
    operation_code: Mapped[str | None] = mapped_column(String(50))
    operation_name: Mapped[str | None] = mapped_column(Text)
    region: Mapped[str | None] = mapped_column(String(255))
    service_center: Mapped[str | None] = mapped_column(String(255))
    owner_type: Mapped[str | None] = mapped_column(String(50))
    source: Mapped[str] = mapped_column(String(255))
    dataset_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    vehicle: Mapped[Vehicle] = relationship(back_populates="events")


class SearchHistory(Base):
    __tablename__ = "search_history"
    __table_args__ = (Index("ix_search_user_created", "user_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    search_type: Mapped[SearchType] = mapped_column(Enum(SearchType, name="search_type"))
    query_hash: Mapped[str] = mapped_column(String(64), index=True)
    query_hint: Mapped[str | None] = mapped_column(String(32))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    found: Mapped[bool] = mapped_column(Boolean, default=False)
    result_label: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user: Mapped[User] = relationship(back_populates="searches")


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str] = mapped_column(String(255))
    version: Mapped[str | None] = mapped_column(String(100))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    import_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    import_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    records_total: Mapped[int] = mapped_column(Integer, default=0)
    records_added: Mapped[int] = mapped_column(Integer, default=0)
    records_updated: Mapped[int] = mapped_column(Integer, default=0)
    records_skipped: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[DatasetStatus] = mapped_column(
        Enum(DatasetStatus, name="dataset_status"), default=DatasetStatus.PENDING
    )
    checksum: Mapped[str | None] = mapped_column(String(64), unique=True)
    schema_signature: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)


class Purchase(Base):
    __tablename__ = "purchases"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(50))
    feature: Mapped[str] = mapped_column(String(50))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="UAH")
    external_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApplicationError(Base):
    __tablename__ = "application_errors"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class MarketplaceListing(Base):
    __tablename__ = "marketplace_listings"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_marketplace_provider_external"),
        Index("ix_marketplace_vin_seen", "normalized_vin", "last_seen_at"),
        Index("ix_marketplace_vehicle_seen", "vehicle_id", "last_seen_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(50))
    external_id: Mapped[str] = mapped_column(String(255))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    vin: Mapped[str | None] = mapped_column(String(32))
    normalized_vin: Mapped[str] = mapped_column(String(17))
    url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(String(500))
    brand: Mapped[str | None] = mapped_column(String(255))
    normalized_brand: Mapped[str | None] = mapped_column(String(255))
    model: Mapped[str | None] = mapped_column(String(255))
    normalized_model: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    mileage: Mapped[int | None] = mapped_column(Integer)
    mileage_unit: Mapped[str | None] = mapped_column(String(10))
    normalized_mileage_km: Mapped[int | None] = mapped_column(Integer)
    city: Mapped[str | None] = mapped_column(String(255))
    region: Mapped[str | None] = mapped_column(String(255))
    description_hash: Mapped[str | None] = mapped_column(String(64))
    seller_type: Mapped[str | None] = mapped_column(String(50))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    vehicle: Mapped[Vehicle | None] = relationship(back_populates="marketplace_listings")
    snapshots: Mapped[list[MarketplaceListingSnapshot]] = relationship(
        back_populates="listing",
        cascade="all, delete-orphan",
        order_by="MarketplaceListingSnapshot.observed_at",
    )


class MarketplaceListingSnapshot(Base):
    __tablename__ = "marketplace_listing_snapshots"
    __table_args__ = (Index("ix_listing_snapshot_observed", "listing_id", "observed_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(
        ForeignKey("marketplace_listings.id", ondelete="CASCADE")
    )
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    mileage: Mapped[int | None] = mapped_column(Integer)
    mileage_unit: Mapped[str | None] = mapped_column(String(10))
    normalized_mileage_km: Mapped[int | None] = mapped_column(Integer)
    description_hash: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    listing: Mapped[MarketplaceListing] = relationship(back_populates="snapshots")


class AuctionEvent(Base):
    __tablename__ = "auction_events"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_auction_provider_external"),
        Index("ix_auction_vin_date", "normalized_vin", "auction_date"),
        Index("ix_auction_vehicle_date", "vehicle_id", "auction_date"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    vin: Mapped[str | None] = mapped_column(String(32))
    normalized_vin: Mapped[str] = mapped_column(String(17))
    provider: Mapped[str] = mapped_column(String(50))
    auction_name: Mapped[str | None] = mapped_column(String(100))
    lot_number: Mapped[str | None] = mapped_column(String(100))
    auction_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    location: Mapped[str | None] = mapped_column(String(255))
    seller_type: Mapped[str | None] = mapped_column(String(100))
    sale_status: Mapped[str | None] = mapped_column(String(100))
    final_bid: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    estimated_retail_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    repair_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    primary_damage: Mapped[str | None] = mapped_column(String(255))
    secondary_damage: Mapped[str | None] = mapped_column(String(255))
    odometer: Mapped[int | None] = mapped_column(Integer)
    odometer_unit: Mapped[str | None] = mapped_column(String(10))
    normalized_odometer_km: Mapped[int | None] = mapped_column(Integer)
    odometer_status: Mapped[str | None] = mapped_column(String(100))
    title_type: Mapped[str | None] = mapped_column(String(255))
    keys_available: Mapped[bool | None] = mapped_column(Boolean)
    run_and_drive: Mapped[bool | None] = mapped_column(Boolean)
    engine_starts: Mapped[bool | None] = mapped_column(Boolean)
    source_url: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str] = mapped_column(String(255))
    brand: Mapped[str | None] = mapped_column(String(255))
    normalized_brand: Mapped[str | None] = mapped_column(String(255))
    model: Mapped[str | None] = mapped_column(String(255))
    normalized_model: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str | None] = mapped_column(String(100))
    engine_capacity: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    vehicle: Mapped[Vehicle | None] = relationship(back_populates="auction_events")
    photos: Mapped[list[AuctionPhoto]] = relationship(
        back_populates="auction_event",
        cascade="all, delete-orphan",
        order_by="AuctionPhoto.position",
    )


class AuctionPhoto(Base):
    __tablename__ = "auction_photos"
    __table_args__ = (
        UniqueConstraint("auction_event_id", "source_url", name="uq_auction_photo_url"),
        Index("ix_auction_photos_event", "auction_event_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    auction_event_id: Mapped[int] = mapped_column(
        ForeignKey("auction_events.id", ondelete="CASCADE")
    )
    source_url: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    auction_event: Mapped[AuctionEvent] = relationship(back_populates="photos")


class MileageRecord(Base):
    __tablename__ = "mileage_records"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_mileage_record_fingerprint"),
        Index("ix_mileage_vin_date", "normalized_vin", "observed_at"),
        Index("ix_mileage_vehicle_date", "vehicle_id", "observed_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    normalized_vin: Mapped[str] = mapped_column(String(17))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    original_mileage: Mapped[int] = mapped_column(Integer)
    original_unit: Mapped[str] = mapped_column(String(10))
    normalized_mileage_km: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(100))
    source_reference: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[str] = mapped_column(String(10), default="MEDIUM")
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    vehicle: Mapped[Vehicle | None] = relationship(back_populates="mileage_records")


class ProviderUsageDaily(Base):
    __tablename__ = "provider_usage_daily"
    __table_args__ = (UniqueConstraint("provider", "date", name="uq_provider_usage_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(50))
    date: Mapped[date] = mapped_column(Date)
    requests_count: Mapped[int] = mapped_column(Integer, default=0)
    cache_hits: Mapped[int] = mapped_column(Integer, default=0)
    cache_misses: Mapped[int] = mapped_column(Integer, default=0)
    successful_requests: Mapped[int] = mapped_column(Integer, default=0)
    failed_requests: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=0)
