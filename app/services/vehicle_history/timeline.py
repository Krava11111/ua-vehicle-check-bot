from __future__ import annotations

from datetime import UTC, datetime, time

from app.schemas.vehicle import VehicleReport
from app.services.auction_history.schemas import AuctionEventView
from app.services.marketplace_history.schemas import MarketplaceListingView
from app.services.vehicle_history.schemas import Confidence, TimelineEvent


class VehicleTimelineService:
    def build(
        self,
        report: VehicleReport,
        auctions: list[AuctionEventView],
        listings: list[MarketplaceListingView],
    ) -> list[TimelineEvent]:
        events: list[TimelineEvent] = []
        for registration_event in report.events:
            if registration_event.registration_date:
                events.append(
                    TimelineEvent(
                        date=datetime.combine(
                            registration_event.registration_date, time.min, tzinfo=UTC
                        ),
                        type="registration",
                        source="МВД",
                        title=registration_event.operation_name
                        or registration_event.operation_code
                        or "Регистрационная операция",
                        description=registration_event.region,
                        confidence=Confidence.HIGH,
                        metadata={"plate": registration_event.normalized_plate}
                        if registration_event.normalized_plate
                        else {},
                    )
                )
        for auction_event in auctions:
            if auction_event.auction_date:
                events.append(
                    TimelineEvent(
                        date=auction_event.auction_date,
                        type="auction",
                        source=auction_event.auction_name or auction_event.provider,
                        title="Аукционное событие",
                        description=auction_event.primary_damage,
                        mileage_km=auction_event.normalized_odometer_km,
                        price=auction_event.final_bid,
                        currency=auction_event.currency,
                        confidence=Confidence.HIGH,
                        metadata={
                            "lot": auction_event.lot_number,
                            "url": auction_event.source_url,
                        },
                    )
                )
        for listing in listings:
            for snapshot in listing.snapshots:
                events.append(
                    TimelineEvent(
                        date=snapshot.observed_at,
                        type="marketplace",
                        source=listing.provider,
                        title="Объявление обнаружено"
                        if snapshot.is_active
                        else "Объявление снято/больше не обнаруживается источником",
                        mileage_km=snapshot.normalized_mileage_km,
                        price=snapshot.price,
                        currency=snapshot.currency,
                        confidence=Confidence.HIGH,
                        metadata={"url": listing.url},
                    )
                )
        return sorted(events, key=lambda event: event.date)
