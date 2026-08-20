from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from app.config import Settings
from app.database.models import User


class Feature(StrEnum):
    PLATE = "plate"
    VIN = "vin"
    HISTORY = "history"
    INSURANCE = "insurance"
    PDF = "pdf"


class AccessService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def can_access(self, user: User, feature: Feature) -> bool:
        if user.is_blocked:
            return False
        free = {
            Feature.PLATE: self.settings.free_plate_search,
            Feature.VIN: self.settings.free_vin_search,
            Feature.HISTORY: self.settings.free_history,
            Feature.INSURANCE: self.settings.free_insurance_search,
            Feature.PDF: self.settings.pdf_reports_enabled and not self.settings.payments_enabled,
        }[feature]
        if not self.settings.payments_enabled:
            return free
        if free:
            return True
        if user.subscription_until and user.subscription_until > datetime.now(UTC):
            return True
        return user.report_balance > 0
