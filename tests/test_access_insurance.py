from datetime import UTC, datetime, timedelta

import pytest

from app.cache import Cache
from app.config import Settings
from app.database.models import User
from app.services.access import AccessService, Feature
from app.services.insurance.disabled_provider import DisabledInsuranceProvider
from app.services.insurance.mock_provider import MockInsuranceProvider
from app.services.insurance.schemas import InsuranceStatus
from app.services.insurance.service import InsuranceService


def user(**kwargs: object) -> User:
    defaults = {"telegram_id": 1, "language": "uk", "report_balance": 0, "is_blocked": False}
    defaults.update(kwargs)
    return User(**defaults)


def test_access_free_mode() -> None:
    access = AccessService(Settings(payments_enabled=False))
    assert access.can_access(user(), Feature.PLATE)
    assert access.can_access(user(), Feature.VIN)
    assert access.can_access(user(), Feature.HISTORY)
    assert access.can_access(user(), Feature.AUCTION_HISTORY)
    assert access.can_access(user(), Feature.AUCTION_PHOTOS)
    assert access.can_access(user(), Feature.MARKETPLACE_HISTORY)
    assert access.can_access(user(), Feature.ODOMETER_HISTORY)
    assert access.can_access(user(), Feature.FULL_REPORT)
    assert access.can_access(user(), Feature.FULL_TIMELINE)
    assert access.can_access(user(), Feature.HISTORY_SCORE)


def test_access_paid_mode() -> None:
    settings = Settings(
        payments_enabled=True, free_vin_search=False, free_history=False, free_plate_search=False
    )
    access = AccessService(settings)
    assert not access.can_access(user(), Feature.VIN)
    assert access.can_access(user(report_balance=1), Feature.VIN)
    assert access.can_access(
        user(subscription_until=datetime.now(UTC) + timedelta(days=1)), Feature.HISTORY
    )
    assert not access.can_access(user(is_blocked=True, report_balance=10), Feature.PLATE)


@pytest.mark.asyncio
async def test_mock_insurance_is_labelled_and_cached(fake_redis: object) -> None:
    service = InsuranceService(MockInsuranceProvider(), Cache(fake_redis), Settings())  # type: ignore[arg-type]
    first = await service.check_plate("АА 1234 ВВ")
    second = await service.check_plate("AA1234BB")
    assert first == second
    assert first.status == InsuranceStatus.NOT_FOUND
    assert first.source.startswith("Mock")


@pytest.mark.asyncio
async def test_disabled_insurance_provider() -> None:
    result = await InsuranceService(DisabledInsuranceProvider(), None, Settings()).check_plate(
        "AA1234BB"
    )
    assert result.status == InsuranceStatus.UNAVAILABLE
