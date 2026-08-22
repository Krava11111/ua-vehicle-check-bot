from __future__ import annotations

import asyncio

import structlog
from redis.asyncio import Redis
from sqlalchemy import select

from app.cache import Cache
from app.config import get_settings
from app.database.models import MarketplaceListing
from app.database.session import create_engine_and_session
from app.services.marketplace_history.providers import AutoRiaProvider, MockAutoRiaProvider
from app.services.marketplace_history.service import MarketplaceHistoryService


async def refresh_once() -> int:
    settings = get_settings()
    if not settings.auto_ria_enabled:
        return 0
    engine, session_factory = create_engine_and_session(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    provider = (
        MockAutoRiaProvider() if settings.marketplace_provider == "mock" else AutoRiaProvider()
    )
    refreshed = 0
    try:
        async with session_factory() as session:
            vins = list(
                (
                    await session.scalars(
                        select(MarketplaceListing.normalized_vin)
                        .where(MarketplaceListing.is_active.is_(True))
                        .distinct()
                    )
                ).all()
            )
            service = MarketplaceHistoryService(session, provider, Cache(redis), settings)
            for vin in vins:
                await service.search_by_vin(vin, force_refresh=True)
                refreshed += 1
    finally:
        await redis.aclose()
        await engine.dispose()
    return refreshed


async def main() -> None:
    settings = get_settings()
    logger = structlog.get_logger()
    while True:
        try:
            logger.info("marketplace_refresh_completed", refreshed=await refresh_once())
        except Exception as exc:
            logger.exception("marketplace_refresh_failed", error=str(exc))
        await asyncio.sleep(max(1, settings.marketplace_refresh_hours) * 3600)


if __name__ == "__main__":
    asyncio.run(main())
