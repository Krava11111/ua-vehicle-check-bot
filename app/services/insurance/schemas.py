from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel


class InsuranceStatus(StrEnum):
    ACTIVE = "ACTIVE"
    NOT_FOUND = "NOT_FOUND"
    UNAVAILABLE = "UNAVAILABLE"


class InsuranceResult(BaseModel):
    status: InsuranceStatus
    query: str
    query_type: str
    company: str | None = None
    policy_number: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    checked_at: datetime
    source: str
    message: str | None = None
