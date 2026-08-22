from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class MarketplaceListingData(BaseModel):
    provider: str
    external_id: str
    vin: str
    url: str | None = None
    title: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    price: Decimal | None = None
    currency: str | None = None
    mileage: int | None = None
    mileage_unit: str | None = None
    city: str | None = None
    region: str | None = None
    description: str | None = Field(default=None, exclude=True)
    description_hash: str | None = None
    seller_type: str | None = None
    observed_at: datetime
    is_active: bool = True
    photo_urls: list[str] = []


class MarketplaceSearchResult(BaseModel):
    provider: str
    listings: list[MarketplaceListingData] = []
    authoritative: bool = False
    unavailable_reason: str | None = None


class MarketplaceSnapshotView(BaseModel):
    observed_at: datetime
    price: Decimal | None = None
    currency: str | None = None
    mileage: int | None = None
    mileage_unit: str | None = None
    normalized_mileage_km: int | None = None
    description_hash: str | None = None
    is_active: bool


class MarketplaceListingView(BaseModel):
    id: int
    provider: str
    external_id: str
    normalized_vin: str
    url: str | None = None
    title: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    price: Decimal | None = None
    currency: str | None = None
    mileage: int | None = None
    mileage_unit: str | None = None
    normalized_mileage_km: int | None = None
    city: str | None = None
    region: str | None = None
    first_seen_at: datetime
    last_seen_at: datetime
    removed_at: datetime | None = None
    is_active: bool
    snapshots: list[MarketplaceSnapshotView] = []
