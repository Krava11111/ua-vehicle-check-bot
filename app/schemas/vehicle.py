from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict


class EventView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    registration_date: date | None = None
    operation_code: str | None = None
    operation_name: str | None = None
    plate: str | None = None
    normalized_plate: str | None = None
    region: str | None = None
    service_center: str | None = None


class HistoryAnalytics(BaseModel):
    first_registration: date | None = None
    last_registration: date | None = None
    event_count: int = 0
    estimated_owner_changes: int = 0
    plate_changes: int = 0
    regions: list[str] = []
    intervals_days: list[int] = []
    warnings: list[str] = []


class VehicleView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    vin: str | None = None
    normalized_vin: str | None = None
    current_plate: str | None = None
    normalized_plate: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    color: str | None = None
    vehicle_type: str | None = None
    body_type: str | None = None
    purpose: str | None = None
    fuel_type: str | None = None
    engine_capacity: int | None = None
    own_weight: int | None = None
    total_weight: int | None = None
    data_source: str


class VehicleReport(BaseModel):
    vehicle: VehicleView
    events: list[EventView]
    analytics: HistoryAnalytics
    matched_by: str
    ambiguous: bool = False
    candidates: int = 1
