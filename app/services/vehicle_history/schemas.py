from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from app.services.auction_history.schemas import AuctionEventView
from app.services.marketplace_history.schemas import MarketplaceListingView


class Confidence(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class WarningSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class MileagePoint(BaseModel):
    date: datetime
    mileage: int
    unit: str
    normalized_mileage_km: int
    source: str
    source_reference: str | None = None
    source_url: str | None = None
    confidence: Confidence = Confidence.MEDIUM


class OdometerWarning(BaseModel):
    severity: WarningSeverity
    previous: MileagePoint
    current: MileagePoint
    difference_km: int
    message: str = "Обнаружено возможное несоответствие показаний пробега"


class RepeatedSaleAnalysis(BaseModel):
    periods_count: int = 0
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    repeated: bool = False


class CrossSourceWarning(BaseModel):
    field: str
    message: str
    sources: dict[str, str]
    severity: WarningSeverity = WarningSeverity.MEDIUM


class DamageFinding(BaseModel):
    source: str
    primary_damage: str | None = None
    secondary_damage: str | None = None
    title_type: str | None = None
    sale_status: str | None = None
    source_url: str | None = None


class TimelineEvent(BaseModel):
    date: datetime
    type: str
    source: str
    title: str
    description: str | None = None
    mileage_km: int | None = None
    price: Decimal | None = None
    currency: str | None = None
    metadata: dict[str, Any] = {}
    confidence: Confidence = Confidence.MEDIUM


class HistoryScore(BaseModel):
    value: int
    factors: list[str]
    disclaimer: str = (
        "Индекс рассчитан сервисом автоматически на основании доступных данных "
        "и не является технической диагностикой автомобиля."
    )


class ExtendedVehicleHistory(BaseModel):
    vin: str
    marketplace: list[MarketplaceListingView] = []
    auctions: list[AuctionEventView] = []
    mileage_points: list[MileagePoint] = []
    odometer_warnings: list[OdometerWarning] = []
    repeated_sales: RepeatedSaleAnalysis = RepeatedSaleAnalysis()
    cross_source_warnings: list[CrossSourceWarning] = []
    damages: list[DamageFinding] = []
    timeline: list[TimelineEvent] = []
    history_score: HistoryScore | None = None
    unavailable_sources: list[str] = []
