from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from redis.asyncio import Redis

from app.config import Settings


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    suspicious: bool = False


class RateLimitService:
    def __init__(self, redis: Redis, settings: Settings) -> None:
        self.redis = redis
        self.settings = settings

    async def check(
        self, telegram_id: int, query_hash: str, is_admin: bool = False
    ) -> RateLimitResult:
        if is_admin:
            return RateLimitResult(True)
        blocked_key = f"rate:block:{telegram_id}"
        if await self.redis.exists(blocked_key):
            return RateLimitResult(False, True)

        minute = datetime.now(UTC).strftime("%Y%m%d%H%M")
        day = datetime.now(UTC).strftime("%Y%m%d")
        minute_key = f"rate:minute:{telegram_id}:{minute}"
        day_key = f"rate:day:{telegram_id}:{day}"
        repeat_key = f"rate:repeat:{telegram_id}:{query_hash}"
        async with self.redis.pipeline(transaction=True) as pipeline:
            pipeline.incr(minute_key)
            pipeline.expire(minute_key, 120)
            pipeline.incr(day_key)
            pipeline.expire(day_key, 172800)
            pipeline.incr(repeat_key)
            pipeline.expire(repeat_key, 300)
            values = await pipeline.execute()
        minute_count, day_count, repeats = int(values[0]), int(values[2]), int(values[4])
        suspicious = repeats > self.settings.duplicate_query_limit
        if suspicious:
            await self.redis.set(blocked_key, "1", ex=self.settings.suspicious_block_seconds)
        allowed = (
            minute_count <= self.settings.rate_limit_per_minute
            and day_count <= self.settings.daily_search_limit
            and not suspicious
        )
        return RateLimitResult(allowed, suspicious)
