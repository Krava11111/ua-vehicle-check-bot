from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(slots=True)
class ImportRow:
    vin: str | None
    plate: str | None
    source_vehicle_id: str | None
    registration_date: date | None
    operation_code: str | None
    operation_name: str | None
    region: str | None
    service_center: str | None
    owner_type: str | None
    brand: str | None
    model: str | None
    year: int | None
    color: str | None
    vehicle_type: str | None
    body_type: str | None
    purpose: str | None
    fuel_type: str | None
    engine_capacity: int | None
    own_weight: int | None
    total_weight: int | None


@dataclass(slots=True)
class ImportStats:
    total: int = 0
    added: int = 0
    updated: int = 0
    skipped: int = 0
