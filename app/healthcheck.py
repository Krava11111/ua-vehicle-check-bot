from __future__ import annotations

import asyncio

from redis.asyncio import Redis
from sqlalchemy import text

from app.config import get_settings
from app.database.session import create_engine_and_session


async def check() -> None:
    settings = get_settings()
    engine, session_factory = create_engine_and_session(settings.database_url)
    redis = Redis.from_url(settings.redis_url)
    try:
        async with session_factory() as session:
            await session.execute(text("SELECT 1"))
        if not await redis.ping():
            raise RuntimeError("Redis ping failed")
    finally:
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(check())
