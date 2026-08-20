from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database.models import Base


class FakePipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self.redis = redis
        self.commands: list[tuple[str, str, Any]] = []

    async def __aenter__(self) -> FakePipeline:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    def incr(self, key: str) -> FakePipeline:
        self.commands.append(("incr", key, None))
        return self

    def expire(self, key: str, ttl: int) -> FakePipeline:
        self.commands.append(("expire", key, ttl))
        return self

    async def execute(self) -> list[Any]:
        values = []
        for command, key, arg in self.commands:
            if command == "incr":
                values.append(await self.redis.incr(key))
            else:
                values.append(await self.redis.expire(key, arg))
        return values


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.expires: dict[str, float] = {}

    def _purge(self, key: str) -> None:
        if key in self.expires and self.expires[key] <= time.time():
            self.data.pop(key, None)
            self.expires.pop(key, None)

    async def get(self, key: str) -> str | None:
        self._purge(key)
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.data[key] = value
        if ex:
            self.expires[key] = time.time() + ex
        return True

    async def delete(self, *keys: str) -> int:
        count = sum(key in self.data for key in keys)
        for key in keys:
            self.data.pop(key, None)
            self.expires.pop(key, None)
        return count

    async def exists(self, key: str) -> int:
        self._purge(key)
        return int(key in self.data)

    async def incr(self, key: str) -> int:
        self._purge(key)
        value = int(self.data.get(key, "0")) + 1
        self.data[key] = str(value)
        return value

    async def expire(self, key: str, ttl: int) -> bool:
        self.expires[key] = time.time() + ttl
        return True

    def pipeline(self, transaction: bool = True) -> FakePipeline:
        return FakePipeline(self)

    async def scan_iter(self, match: str, count: int = 10) -> AsyncIterator[str]:
        prefix = match.rstrip("*")
        for key in list(self.data):
            if key.startswith(prefix):
                yield key


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest_asyncio.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest_asyncio.fixture
async def session(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with session_factory() as value:
        yield value
