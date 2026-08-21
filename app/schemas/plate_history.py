from __future__ import annotations

from datetime import date
from enum import StrEnum

from pydantic import BaseModel


class AssignmentConfidence(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class PlateAssignmentPeriod(BaseModel):
    plate: str
    normalized_plate: str
    vehicle_id: int
    vin: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    color: str | None = None
    vehicle_type: str | None = None
    first_seen_at: date | None = None
    last_seen_at: date | None = None
    events_count: int
    confidence: AssignmentConfidence
    source: str


class PlateHistoryReport(BaseModel):
    plate: str
    normalized_plate: str
    assignments: list[PlateAssignmentPeriod] = []
    has_multiple_vehicles: bool = False
    has_unresolved_records: bool = False
    short_transition_warning: bool = False
