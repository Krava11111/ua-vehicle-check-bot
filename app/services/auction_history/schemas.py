from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class AuctionEventData(BaseModel):
    provider: str
    external_id: str
    vin: str
    auction_name: str | None = None
    lot_number: str | None = None
    auction_date: datetime | None = None
    location: str | None = None
    seller_type: str | None = None
    sale_status: str | None = None
    final_bid: Decimal | None = None
    currency: str | None = None
    estimated_retail_value: Decimal | None = None
    repair_cost: Decimal | None = None
    primary_damage: str | None = None
    secondary_damage: str | None = None
    odometer: int | None = None
    odometer_unit: str | None = None
    odometer_status: str | None = None
    title_type: str | None = None
    keys_available: bool | None = None
    run_and_drive: bool | None = None
    engine_starts: bool | None = None
    source_url: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    color: str | None = None
    engine_capacity: int | None = None
    photo_urls: list[str] = []


class AuctionSearchResult(BaseModel):
    provider: str
    events: list[AuctionEventData] = []
    unavailable_reason: str | None = None


class AuctionEventView(BaseModel):
    id: int
    provider: str
    external_id: str
    normalized_vin: str
    auction_name: str | None = None
    lot_number: str | None = None
    auction_date: datetime | None = None
    location: str | None = None
    sale_status: str | None = None
    final_bid: Decimal | None = None
    currency: str | None = None
    estimated_retail_value: Decimal | None = None
    repair_cost: Decimal | None = None
    primary_damage: str | None = None
    secondary_damage: str | None = None
    odometer: int | None = None
    odometer_unit: str | None = None
    normalized_odometer_km: int | None = None
    odometer_status: str | None = None
    title_type: str | None = None
    keys_available: bool | None = None
    run_and_drive: bool | None = None
    engine_starts: bool | None = None
    source_url: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    color: str | None = None
    engine_capacity: int | None = None
    photo_urls: list[str] = []
