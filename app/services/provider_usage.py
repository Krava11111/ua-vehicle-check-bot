from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import ProviderUsageDaily


class ProviderUsageService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(
        self,
        provider: str,
        *,
        cache_hit: bool = False,
        cache_miss: bool = False,
        requested: bool = False,
        success: bool = False,
        failed: bool = False,
        estimated_cost: Decimal = Decimal("0"),
    ) -> None:
        today: date = datetime.now(UTC).date()
        row = await self.session.scalar(
            select(ProviderUsageDaily).where(
                ProviderUsageDaily.provider == provider, ProviderUsageDaily.date == today
            )
        )
        if row is None:
            row = ProviderUsageDaily(provider=provider, date=today)
            self.session.add(row)
            await self.session.flush()
        row.requests_count += int(requested)
        row.cache_hits += int(cache_hit)
        row.cache_misses += int(cache_miss)
        row.successful_requests += int(success)
        row.failed_requests += int(failed)
        row.estimated_cost += estimated_cost


async def enforce_provider_limit(cache: object | None, provider: str, limit: int) -> None:
    if cache is None or limit <= 0:
        return
    redis = getattr(cache, "redis", None)
    if redis is None:
        return
    today = datetime.now(UTC).strftime("%Y%m%d")
    key = f"provider-limit:{provider}:{today}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 90000)
    if count > limit:
        raise RuntimeError("provider_daily_limit")
