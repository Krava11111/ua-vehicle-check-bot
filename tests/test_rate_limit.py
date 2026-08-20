import pytest

from app.config import Settings
from app.services.rate_limit import RateLimitService


@pytest.mark.asyncio
async def test_rate_limit(fake_redis: object) -> None:
    service = RateLimitService(fake_redis, Settings(rate_limit_per_minute=2, daily_search_limit=5))  # type: ignore[arg-type]
    assert (await service.check(1, "a")).allowed
    assert (await service.check(1, "b")).allowed
    assert not (await service.check(1, "c")).allowed
    assert (await service.check(99, "a", is_admin=True)).allowed


@pytest.mark.asyncio
async def test_repeat_detection_blocks_temporarily(fake_redis: object) -> None:
    service = RateLimitService(
        fake_redis, Settings(duplicate_query_limit=2, rate_limit_per_minute=20)
    )  # type: ignore[arg-type]
    assert (await service.check(2, "same")).allowed
    assert (await service.check(2, "same")).allowed
    result = await service.check(2, "same")
    assert not result.allowed and result.suspicious
    assert not (await service.check(2, "different")).allowed
