from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis


class Cache:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def get_json(self, key: str) -> dict[str, Any] | list[Any] | None:
        value = await self.redis.get(key)
        if value is None:
            return None
        if isinstance(value, bytes):
            value = value.decode()
        return json.loads(value)

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        await self.redis.set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl)

    async def delete(self, *keys: str) -> None:
        if keys:
            await self.redis.delete(*keys)

    async def delete_pattern(self, pattern: str, batch_size: int = 500) -> int:
        removed = 0
        async for key in self.redis.scan_iter(match=pattern, count=batch_size):
            removed += await self.redis.delete(key)
        return removed
