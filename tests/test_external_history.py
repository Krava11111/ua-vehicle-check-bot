from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.cache import Cache
from app.config import Settings
from app.database.models import (
    AuctionEvent,
    MarketplaceListingSnapshot,
    MileageRecord,
    Vehicle,
)
from app.schemas.vehicle import HistoryAnalytics, VehicleReport, VehicleView
from app.services.auction_history.base import AuctionProvider
from app.services.auction_history.providers.mock import MockAuctionProvider
from app.services.auction_history.schemas import AuctionEventData, AuctionSearchResult
from app.services.auction_history.service import AuctionHistoryService
from app.services.marketplace_history.base import MarketplaceProvider
from app.services.marketplace_history.providers.mock import MockAutoRiaProvider
from app.services.marketplace_history.schemas import (
    MarketplaceListingData,
    MarketplaceListingView,
    MarketplaceSearchResult,
)
from app.services.marketplace_history.service import MarketplaceHistoryService
from app.services.reports import ReportService
from app.services.vehicle_history.cross_source import CrossSourceAnalyzer
from app.services.vehicle_history.damage import DamageAnalyzer
from app.services.vehicle_history.history_score import HistoryScoreService
from app.services.vehicle_history.normalization import MileageNormalizer
from app.services.vehicle_history.odometer import OdometerAnalyzer
from app.services.vehicle_history.repeated_sales import RepeatedSaleAnalyzer
from app.services.vehicle_history.schemas import (
    Confidence,
    ExtendedVehicleHistory,
    MileagePoint,
    WarningSeverity,
)
from app.services.vehicle_history.timeline import VehicleTimelineService

VIN = "WVWZZZ3CZHE123456"
NOW = datetime(2026, 5, 17, tzinfo=UTC)


def listing(
    external_id: str = "ria-1",
    *,
    price: str = "24900",
    mileage: int = 91000,
    observed_at: datetime = NOW,
    active: bool = True,
) -> MarketplaceListingData:
    return MarketplaceListingData(
        provider="AUTO.RIA",
        external_id=external_id,
        vin=VIN,
        url=f"https://auto.ria.com/{external_id}",
        brand="Bmw",
        model="330 i",
        year=2019,
        price=Decimal(price),
        currency="$",
        mileage=mileage,
        mileage_unit="km",
        city="Киев",
        observed_at=observed_at,
        is_active=active,
    )


async def vehicle(session: object) -> Vehicle:
    row = Vehicle(
        vin=VIN,
        normalized_vin=VIN,
        current_plate="AA1234BB",
        normalized_plate="AA1234BB",
        brand="BMW",
        model="330I",
        year=2019,
        data_source="МВД",
    )
    session.add(row)  # type: ignore[attr-defined]
    await session.flush()  # type: ignore[attr-defined]
    return row


async def test_marketplace_snapshots_dedupe_changes_removal_and_reappearance(
    session: object, fake_redis: object
) -> None:
    row = await vehicle(session)
    provider = MockAutoRiaProvider([listing()])
    settings = Settings(auto_ria_cache_ttl=0)
    service = MarketplaceHistoryService(session, provider, Cache(fake_redis), settings)  # type: ignore[arg-type]
    first, error = await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert error is None and len(first) == 1
    await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert await session.scalar(select(func.count(MarketplaceListingSnapshot.id))) == 1  # type: ignore[attr-defined]

    provider.listings["ria-1"] = listing(
        price="22500", mileage=93000, observed_at=NOW + timedelta(days=1)
    )
    changed, _ = await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert changed[0].price == Decimal("22500")
    assert await session.scalar(select(func.count(MarketplaceListingSnapshot.id))) == 2  # type: ignore[attr-defined]
    assert await session.scalar(select(func.count(MileageRecord.id))) == 2  # type: ignore[attr-defined]

    provider.listings.clear()
    removed, _ = await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert removed[0].is_active is False and removed[0].removed_at is not None
    provider.listings["ria-2"] = listing(
        "ria-2", price="21500", mileage=118000, observed_at=NOW + timedelta(days=700)
    )
    repeated, _ = await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert RepeatedSaleAnalyzer.analyze(repeated).repeated is True


async def test_auction_multiple_events_are_saved_without_duplicates(
    session: object, fake_redis: object
) -> None:
    row = await vehicle(session)
    events = [
        AuctionEventData(
            provider="legal-api",
            external_id="lot-1",
            vin=VIN,
            auction_name="Copart",
            auction_date=NOW,
            odometer=61340,
            odometer_unit="mi",
            primary_damage="Front End",
            photo_urls=["https://images.example/1.jpg"],
        ),
        AuctionEventData(
            provider="legal-api",
            external_id="lot-2",
            vin=VIN,
            auction_name="IAAI",
            auction_date=NOW + timedelta(days=30),
            odometer=102000,
            odometer_unit="km",
        ),
    ]
    service = AuctionHistoryService(
        session, MockAuctionProvider(events), Cache(fake_redis), Settings()
    )  # type: ignore[arg-type]
    result, error = await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert error is None and len(result) == 2
    await service.search_by_vin(VIN, row.id, force_refresh=True)
    assert await session.scalar(select(func.count(AuctionEvent.id))) == 2  # type: ignore[attr-defined]
    assert result[0].normalized_odometer_km == 98717


def test_miles_to_km_and_odometer_tolerance() -> None:
    assert MileageNormalizer.to_km(61340, "mi") == 98717
    points = [
        MileagePoint(
            date=NOW,
            mileage=137000,
            unit="km",
            normalized_mileage_km=137000,
            source="AUTO.RIA",
            confidence=Confidence.HIGH,
        ),
        MileagePoint(
            date=NOW + timedelta(days=1),
            mileage=136500,
            unit="km",
            normalized_mileage_km=136500,
            source="AUTO.RIA",
            confidence=Confidence.HIGH,
        ),
        MileagePoint(
            date=NOW + timedelta(days=2),
            mileage=91000,
            unit="km",
            normalized_mileage_km=91000,
            source="AUTO.RIA",
            confidence=Confidence.HIGH,
        ),
    ]
    warnings = OdometerAnalyzer(1000).analyze(points)
    assert len(warnings) == 1 and warnings[0].severity == WarningSeverity.HIGH


def report() -> VehicleReport:
    return VehicleReport(
        vehicle=VehicleView(
            id=1,
            normalized_vin=VIN,
            brand="BMW",
            model="330I",
            year=2019,
            color="black",
            engine_capacity=1998,
            data_source="МВД",
        ),
        events=[],
        analytics=HistoryAnalytics(),
        matched_by="VIN",
    )


def test_cross_source_timeline_and_history_score() -> None:
    auction = AuctionEventData(
        provider="legal-api",
        external_id="lot",
        vin=VIN,
        auction_name="Copart",
        auction_date=NOW,
        brand="Bmw",
        model="330 i",
        year=2019,
        primary_damage="Front End",
    )
    auction_view = __import__(
        "app.services.auction_history.schemas", fromlist=["AuctionEventView"]
    ).AuctionEventView(
        id=1, normalized_vin=VIN, **auction.model_dump(exclude={"vin", "photo_urls"})
    )
    market = MarketplaceListingView(
        id=1,
        provider="AUTO.RIA",
        external_id="ria",
        normalized_vin=VIN,
        year=2017,
        first_seen_at=NOW + timedelta(days=1),
        last_seen_at=NOW + timedelta(days=1),
        is_active=True,
        snapshots=[],
    )
    cross = CrossSourceAnalyzer().analyze(report(), [auction_view], [market])
    assert [item.field for item in cross] == ["year"]
    timeline = VehicleTimelineService().build(report(), [auction_view], [market])
    assert timeline[0].type == "auction"
    assert DamageAnalyzer.analyze([auction_view])[0].primary_damage == "Front End"
    score = HistoryScoreService(Settings()).calculate(
        1, 1, [], cross, RepeatedSaleAnalyzer.analyze([market])
    )
    assert 0 <= score.value < 100 and "не является технической диагностикой" in score.disclaimer


class FailingMarketplaceProvider(MarketplaceProvider):
    name = "failing"

    async def search_by_vin(self, vin: str) -> MarketplaceSearchResult:
        raise OSError("offline")

    async def get_listing(self, listing_id: str) -> MarketplaceListingData | None:
        return None


class SlowAuctionProvider(AuctionProvider):
    name = "slow"

    async def search_by_vin(self, vin: str) -> AuctionSearchResult:
        await asyncio.sleep(0.05)
        return AuctionSearchResult(provider=self.name)


async def test_external_failure_timeout_and_cache_do_not_break_report(
    session: object, fake_redis: object
) -> None:
    market, market_error = await MarketplaceHistoryService(
        session, FailingMarketplaceProvider(), Cache(fake_redis), Settings()
    ).search_by_vin(VIN)  # type: ignore[arg-type]
    auctions, auction_error = await AuctionHistoryService(
        session,
        SlowAuctionProvider(),
        Cache(fake_redis),
        Settings(external_provider_timeout_seconds=0.001),
    ).search_by_vin(VIN)  # type: ignore[arg-type]
    assert market == [] and market_error == "OSError"
    assert auctions == [] and auction_error == "TimeoutError"


async def test_marketplace_redis_cache_and_external_rate_limit(
    session: object, fake_redis: object
) -> None:
    provider = MockAutoRiaProvider([listing()])
    service = MarketplaceHistoryService(
        session,
        provider,
        Cache(fake_redis),  # type: ignore[arg-type]
        Settings(auto_ria_cache_ttl=3600, external_provider_daily_limit=1),
    )
    await service.search_by_vin(VIN, force_refresh=True)
    cached, error = await service.search_by_vin(VIN)
    assert len(cached) == 1 and error is None and provider.calls == 1
    stored, limited = await service.search_by_vin(VIN, force_refresh=True)
    assert len(stored) == 1 and limited == "RuntimeError" and provider.calls == 1


def test_full_report_uses_safe_absence_wording() -> None:
    extra = ExtendedVehicleHistory(vin=VIN)
    text = "\n".join(ReportService.render_full(report(), extra))
    assert "В подключённых источниках аукционных записей не найдено" in text
    assert "В доступной истории объявлений совпадений не найдено" in text
    assert "не является технической диагностикой" not in text
