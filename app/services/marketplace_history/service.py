from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cache import Cache
from app.config import Settings
from app.database.models import MarketplaceListing, MarketplaceListingSnapshot, MileageRecord
from app.domain.normalization import normalize_vin
from app.services.marketplace_history.base import MarketplaceProvider
from app.services.marketplace_history.schemas import (
    MarketplaceListingData,
    MarketplaceListingView,
    MarketplaceSnapshotView,
)
from app.services.provider_usage import ProviderUsageService, enforce_provider_limit
from app.services.vehicle_history.normalization import (
    BrandNormalizer,
    CurrencyNormalizer,
    MileageNormalizer,
    ModelNormalizer,
)


class MarketplaceHistoryService:
    def __init__(
        self,
        session: AsyncSession,
        provider: MarketplaceProvider,
        cache: Cache | None,
        settings: Settings,
    ) -> None:
        self.session = session
        self.provider = provider
        self.cache = cache
        self.settings = settings
        self.usage = ProviderUsageService(session)

    async def search_by_vin(
        self, raw_vin: str, vehicle_id: int | None = None, *, force_refresh: bool = False
    ) -> tuple[list[MarketplaceListingView], str | None]:
        vin = normalize_vin(raw_vin)
        if not vin:
            raise ValueError("invalid_vin")
        key = f"marketplace:vin:{vin}"
        if self.cache and not force_refresh:
            cached = await self.cache.get_json(key)
            if isinstance(cached, list):
                await self.usage.record(self.provider.name, cache_hit=True)
                return [MarketplaceListingView.model_validate(item) for item in cached], None
        await self.usage.record(self.provider.name, cache_miss=True)
        stored = await self._load(vin)
        latest = max((item.last_seen_at for item in stored), default=None)
        if latest and latest.tzinfo is None:
            latest = latest.replace(tzinfo=UTC)
        fresh = bool(
            latest
            and latest >= datetime.now(UTC) - timedelta(seconds=self.settings.auto_ria_cache_ttl)
        )
        if fresh and not force_refresh:
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
            await self._persist(
                vin, result.listings, vehicle_id, result.authoritative, result.provider
            )
            await self.session.commit()
            stored = await self._load(vin)
            await self._cache(key, stored)
            return stored, None
        except (TimeoutError, RuntimeError, OSError) as exc:
            await self.usage.record(self.provider.name, requested=True, failed=True)
            await self.session.commit()
            return stored, type(exc).__name__

    async def _load(self, vin: str) -> list[MarketplaceListingView]:
        statement = (
            select(MarketplaceListing)
            .where(MarketplaceListing.normalized_vin == vin)
            .options(selectinload(MarketplaceListing.snapshots))
            .order_by(MarketplaceListing.first_seen_at)
        )
        rows = list((await self.session.scalars(statement)).unique().all())
        return [self._view(row) for row in rows]

    @staticmethod
    def _view(row: MarketplaceListing) -> MarketplaceListingView:
        return MarketplaceListingView(
            id=row.id,
            provider=row.provider,
            external_id=row.external_id,
            normalized_vin=row.normalized_vin,
            url=row.url,
            title=row.title,
            brand=row.brand,
            model=row.model,
            year=row.year,
            price=row.price,
            currency=row.currency,
            mileage=row.mileage,
            mileage_unit=row.mileage_unit,
            normalized_mileage_km=row.normalized_mileage_km,
            city=row.city,
            region=row.region,
            first_seen_at=row.first_seen_at,
            last_seen_at=row.last_seen_at,
            removed_at=row.removed_at,
            is_active=row.is_active,
            snapshots=[
                MarketplaceSnapshotView(
                    observed_at=item.observed_at,
                    price=item.price,
                    currency=item.currency,
                    mileage=item.mileage,
                    mileage_unit=item.mileage_unit,
                    normalized_mileage_km=item.normalized_mileage_km,
                    description_hash=item.description_hash,
                    is_active=item.is_active,
                )
                for item in row.snapshots
            ],
        )

    async def _persist(
        self,
        vin: str,
        items: list[MarketplaceListingData],
        vehicle_id: int | None,
        authoritative: bool,
        authoritative_provider: str,
    ) -> None:
        seen: set[tuple[str, str]] = set()
        for item in items:
            item_vin = normalize_vin(item.vin)
            if item_vin != vin:
                continue
            seen.add((item.provider, item.external_id))
            row = await self.session.scalar(
                select(MarketplaceListing)
                .where(
                    MarketplaceListing.provider == item.provider,
                    MarketplaceListing.external_id == item.external_id,
                )
                .options(selectinload(MarketplaceListing.snapshots))
            )
            description_hash = item.description_hash or (
                hashlib.sha256(item.description.encode()).hexdigest() if item.description else None
            )
            mileage_km = MileageNormalizer.to_km(item.mileage, item.mileage_unit)
            currency = CurrencyNormalizer.normalize(item.currency)
            if row is None:
                row = MarketplaceListing(
                    provider=item.provider,
                    external_id=item.external_id,
                    vehicle_id=vehicle_id,
                    vin=item.vin,
                    normalized_vin=vin,
                    first_seen_at=item.observed_at,
                    last_seen_at=item.observed_at,
                )
                self.session.add(row)
                await self.session.flush()
                previous = None
            else:
                previous = row.snapshots[-1] if row.snapshots else None
            changed = previous is None or any(
                (
                    previous.price != item.price,
                    previous.currency != currency,
                    previous.mileage != item.mileage,
                    previous.mileage_unit != item.mileage_unit,
                    previous.description_hash != description_hash,
                    previous.is_active != item.is_active,
                )
            )
            row.vehicle_id = row.vehicle_id or vehicle_id
            row.url, row.title, row.brand, row.model, row.year = (
                item.url,
                item.title,
                item.brand,
                item.model,
                item.year,
            )
            row.normalized_brand, row.normalized_model = (
                BrandNormalizer.normalize(item.brand),
                ModelNormalizer.normalize(item.model),
            )
            row.price, row.currency, row.mileage, row.mileage_unit = (
                item.price,
                currency,
                item.mileage,
                item.mileage_unit,
            )
            row.normalized_mileage_km, row.city, row.region = mileage_km, item.city, item.region
            row.description_hash, row.seller_type, row.last_seen_at = (
                description_hash,
                item.seller_type,
                item.observed_at,
            )
            row.is_active = item.is_active
            row.removed_at = None if item.is_active else item.observed_at
            if changed:
                self.session.add(
                    MarketplaceListingSnapshot(
                        listing_id=row.id,
                        observed_at=item.observed_at,
                        price=item.price,
                        currency=currency,
                        mileage=item.mileage,
                        mileage_unit=item.mileage_unit,
                        normalized_mileage_km=mileage_km,
                        description_hash=description_hash,
                        is_active=item.is_active,
                    )
                )
            if mileage_km is not None:
                await self._add_mileage(
                    vin,
                    vehicle_id,
                    item.observed_at,
                    item.mileage or 0,
                    item.mileage_unit or "km",
                    mileage_km,
                    item.provider,
                    item.external_id,
                    item.url,
                )
        if authoritative:
            active = list(
                (
                    await self.session.scalars(
                        select(MarketplaceListing).where(
                            MarketplaceListing.normalized_vin == vin,
                            MarketplaceListing.provider == authoritative_provider,
                            MarketplaceListing.is_active.is_(True),
                        )
                    )
                ).all()
            )
            now = datetime.now(UTC)
            for row in active:
                if (row.provider, row.external_id) not in seen:
                    row.is_active, row.removed_at, row.last_seen_at = False, now, now
                    self.session.add(
                        MarketplaceListingSnapshot(
                            listing_id=row.id,
                            observed_at=now,
                            price=row.price,
                            currency=row.currency,
                            mileage=row.mileage,
                            mileage_unit=row.mileage_unit,
                            normalized_mileage_km=row.normalized_mileage_km,
                            description_hash=row.description_hash,
                            is_active=False,
                        )
                    )

    async def _add_mileage(
        self,
        vin: str,
        vehicle_id: int | None,
        observed_at: datetime,
        original: int,
        unit: str,
        km: int,
        source: str,
        reference: str,
        url: str | None,
    ) -> None:
        fingerprint = hashlib.sha256(
            f"{vin}|{source}|{reference}|{observed_at.isoformat()}|{original}|{unit}".encode()
        ).hexdigest()
        if not await self.session.scalar(
            select(MileageRecord.id).where(MileageRecord.fingerprint == fingerprint)
        ):
            self.session.add(
                MileageRecord(
                    vehicle_id=vehicle_id,
                    normalized_vin=vin,
                    observed_at=observed_at,
                    original_mileage=original,
                    original_unit=unit,
                    normalized_mileage_km=km,
                    source=source,
                    source_reference=reference,
                    source_url=url,
                    confidence="HIGH",
                    fingerprint=fingerprint,
                )
            )

    async def _cache(self, key: str, items: list[MarketplaceListingView]) -> None:
        if self.cache:
            await self.cache.set_json(
                key,
                [item.model_dump(mode="json") for item in items],
                self.settings.auto_ria_cache_ttl,
            )
