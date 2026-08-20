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
    AUCTION_HISTORY = "auction_history"
    AUCTION_PHOTOS = "auction_photos"
    MARKETPLACE_HISTORY = "marketplace_history"
    ODOMETER_HISTORY = "odometer_history"
    FULL_REPORT = "full_report"
    FULL_TIMELINE = "full_timeline"
    HISTORY_SCORE = "history_score"


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
            Feature.AUCTION_HISTORY: self.settings.free_auction_history,
            Feature.AUCTION_PHOTOS: self.settings.free_auction_photos,
            Feature.MARKETPLACE_HISTORY: self.settings.free_marketplace_history,
            Feature.ODOMETER_HISTORY: self.settings.free_odometer_history,
            Feature.FULL_REPORT: self.settings.free_full_report,
            Feature.FULL_TIMELINE: self.settings.free_full_timeline,
            Feature.HISTORY_SCORE: self.settings.free_history_score,
        }[feature]
        if not self.settings.payments_enabled:
            return free
        if free:
            return True
        if user.subscription_until and user.subscription_until > datetime.now(UTC):
            return True
        return user.report_balance > 0
