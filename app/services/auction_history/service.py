from __future__ import annotations

import asyncio
import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cache import Cache
from app.config import Settings
from app.database.models import AuctionEvent, AuctionPhoto, MileageRecord
from app.domain.normalization import normalize_vin
from app.services.auction_history.base import AuctionProvider
from app.services.auction_history.schemas import AuctionEventData, AuctionEventView
from app.services.provider_usage import ProviderUsageService, enforce_provider_limit
from app.services.vehicle_history.normalization import (
    BrandNormalizer,
    CurrencyNormalizer,
    MileageNormalizer,
    ModelNormalizer,
)


class AuctionHistoryService:
    def __init__(
        self,
        session: AsyncSession,
        provider: AuctionProvider,
        cache: Cache | None,
        settings: Settings,
    ) -> None:
        self.session, self.provider, self.cache, self.settings = session, provider, cache, settings
        self.usage = ProviderUsageService(session)

    async def search_by_vin(
        self, raw_vin: str, vehicle_id: int | None = None, *, force_refresh: bool = False
    ) -> tuple[list[AuctionEventView], str | None]:
        vin = normalize_vin(raw_vin)
        if not vin:
            raise ValueError("invalid_vin")
        key = f"auction:vin:{vin}"
        if self.cache and not force_refresh:
            cached = await self.cache.get_json(key)
            if isinstance(cached, list):
                await self.usage.record(self.provider.name, cache_hit=True)
                return [AuctionEventView.model_validate(item) for item in cached], None
        await self.usage.record(self.provider.name, cache_miss=True)
        stored = await self._load(vin)
        if stored and not force_refresh:
            await self._cache(key, stored)
            return stored, None
        try:
            await enforce_provider_limit(
                self.cache, self.provider.name, self.settings.external_provider_daily_limit
            )
            async with asyncio.timeout(self.settings.external_provider_timeout_seconds):
                result = await self.provider.search_by_vin(vin)
            await self.usage.record(
                self.provider.name,
                requested=True,
                success=result.unavailable_reason is None,
                failed=result.unavailable_reason is not None,
            )
            if result.unavailable_reason:
                return stored, result.unavailable_reason
            for item in result.events:
                await self._persist(vin, item, vehicle_id)
            await self.session.commit()
            stored = await self._load(vin)
            await self._cache(key, stored)
            return stored, None
        except (TimeoutError, RuntimeError, OSError) as exc:
            await self.usage.record(self.provider.name, requested=True, failed=True)
            await self.session.commit()
            return stored, type(exc).__name__

    async def _load(self, vin: str) -> list[AuctionEventView]:
        rows = list(
            (
                await self.session.scalars(
                    select(AuctionEvent)
                    .where(AuctionEvent.normalized_vin == vin)
                    .options(selectinload(AuctionEvent.photos))
                    .order_by(AuctionEvent.auction_date)
                )
            )
            .unique()
            .all()
        )
        return [
            AuctionEventView(
                id=row.id,
                provider=row.provider,
                external_id=row.external_id,
                normalized_vin=row.normalized_vin,
                auction_name=row.auction_name,
                lot_number=row.lot_number,
                auction_date=row.auction_date,
                location=row.location,
                sale_status=row.sale_status,
                final_bid=row.final_bid,
                currency=row.currency,
                estimated_retail_value=row.estimated_retail_value,
                repair_cost=row.repair_cost,
                primary_damage=row.primary_damage,
                secondary_damage=row.secondary_damage,
                odometer=row.odometer,
                odometer_unit=row.odometer_unit,
                normalized_odometer_km=row.normalized_odometer_km,
                odometer_status=row.odometer_status,
                title_type=row.title_type,
                keys_available=row.keys_available,
                run_and_drive=row.run_and_drive,
                engine_starts=row.engine_starts,
                source_url=row.source_url,
                brand=row.brand,
                model=row.model,
                year=row.year,
                color=row.color,
                engine_capacity=row.engine_capacity,
                photo_urls=[photo.source_url for photo in row.photos],
            )
            for row in rows
        ]

    async def _persist(self, vin: str, item: AuctionEventData, vehicle_id: int | None) -> None:
        if normalize_vin(item.vin) != vin:
            return
        row = await self.session.scalar(
            select(AuctionEvent)
            .where(
                AuctionEvent.provider == item.provider, AuctionEvent.external_id == item.external_id
            )
            .options(selectinload(AuctionEvent.photos))
        )
        mileage_km = MileageNormalizer.to_km(item.odometer, item.odometer_unit)
        values = item.model_dump(exclude={"photo_urls", "vin", "currency"})
        created = row is None
        if created:
            row = AuctionEvent(
                provider=item.provider,
                external_id=item.external_id,
                vin=item.vin,
                normalized_vin=vin,
            )
            self.session.add(row)
            await self.session.flush()
        assert row is not None
        for name, value in values.items():
            setattr(row, name, value)
        row.vehicle_id = row.vehicle_id or vehicle_id
        row.currency = CurrencyNormalizer.normalize(item.currency)
        row.normalized_odometer_km = mileage_km
        row.normalized_brand = BrandNormalizer.normalize(item.brand)
        row.normalized_model = ModelNormalizer.normalize(item.model)
        existing = set() if created else {photo.source_url for photo in row.photos}
        for position, url in enumerate(item.photo_urls):
            if url not in existing:
                self.session.add(
                    AuctionPhoto(
                        auction_event_id=row.id,
                        source_url=url,
                        position=position,
                        is_primary=position == 0,
                    )
                )
        if mileage_km is not None and item.auction_date is not None:
            fingerprint = hashlib.sha256(
                f"{vin}|{item.provider}|{item.external_id}|{item.auction_date.isoformat()}|{item.odometer}|{item.odometer_unit}".encode()
            ).hexdigest()
            if not await self.session.scalar(
                select(MileageRecord.id).where(MileageRecord.fingerprint == fingerprint)
            ):
                self.session.add(
                    MileageRecord(
                        vehicle_id=vehicle_id,
                        normalized_vin=vin,
                        observed_at=item.auction_date,
                        original_mileage=item.odometer or 0,
                        original_unit=item.odometer_unit or "km",
                        normalized_mileage_km=mileage_km,
                        source=item.auction_name or item.provider,
                        source_reference=item.external_id,
                        source_url=item.source_url,
                        confidence="HIGH",
                        fingerprint=fingerprint,
                    )
                )

    async def _cache(self, key: str, items: list[AuctionEventView]) -> None:
        if self.cache:
            await self.cache.set_json(
                key,
                [item.model_dump(mode="json") for item in items],
                self.settings.auction_cache_ttl,
            )
