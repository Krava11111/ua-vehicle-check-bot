from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database.models import MileageRecord
from app.schemas.vehicle import VehicleReport
from app.services.auction_history.service import AuctionHistoryService
from app.services.marketplace_history.service import MarketplaceHistoryService
from app.services.vehicle_history.cross_source import CrossSourceAnalyzer
from app.services.vehicle_history.damage import DamageAnalyzer
from app.services.vehicle_history.history_score import HistoryScoreService
from app.services.vehicle_history.odometer import OdometerAnalyzer
from app.services.vehicle_history.repeated_sales import RepeatedSaleAnalyzer
from app.services.vehicle_history.schemas import Confidence, ExtendedVehicleHistory, MileagePoint
from app.services.vehicle_history.timeline import VehicleTimelineService


class VehicleHistoryService:
    def __init__(
        self,
        session: AsyncSession,
        marketplace: MarketplaceHistoryService,
        auctions: AuctionHistoryService,
        settings: Settings,
    ) -> None:
        self.session, self.marketplace, self.auctions, self.settings = (
            session,
            marketplace,
            auctions,
            settings,
        )

    async def build(self, report: VehicleReport) -> ExtendedVehicleHistory | None:
        vin = report.vehicle.normalized_vin
        if not vin:
            return None
        marketplace, marketplace_error = await self.marketplace.search_by_vin(
            vin, report.vehicle.id
        )
        auctions, auction_error = await self.auctions.search_by_vin(vin, report.vehicle.id)
        records = list(
            (
                await self.session.scalars(
                    select(MileageRecord)
                    .where(MileageRecord.normalized_vin == vin)
                    .order_by(MileageRecord.observed_at)
                )
            ).all()
        )
        points = [
            MileagePoint(
                date=row.observed_at,
                mileage=row.original_mileage,
                unit=row.original_unit,
                normalized_mileage_km=row.normalized_mileage_km,
                source=row.source,
                source_reference=row.source_reference,
                source_url=row.source_url,
                confidence=Confidence(row.confidence),
            )
            for row in records
        ]
        odometer = OdometerAnalyzer(self.settings.odometer_rollback_tolerance_km).analyze(points)
        repeated = RepeatedSaleAnalyzer.analyze(marketplace)
        cross = CrossSourceAnalyzer().analyze(report, auctions, marketplace)
        damage_findings = DamageAnalyzer.analyze(auctions)
        timeline = VehicleTimelineService().build(report, auctions, marketplace)
        score = (
            HistoryScoreService(self.settings).calculate(
                len(auctions), len(damage_findings), odometer, cross, repeated
            )
            if self.settings.history_score_enabled
            else None
        )
        unavailable = [
            label
            for label, error in (("marketplace", marketplace_error), ("auction", auction_error))
            if error
        ]
        return ExtendedVehicleHistory(
            vin=vin,
            marketplace=marketplace,
            auctions=auctions,
            mileage_points=points,
            odometer_warnings=odometer,
            repeated_sales=repeated,
            cross_source_warnings=cross,
            damages=damage_findings,
            timeline=timeline,
            history_score=score,
            unavailable_sources=unavailable,
        )
