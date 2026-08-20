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
