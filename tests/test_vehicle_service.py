from datetime import date

import pytest

from app.cache import Cache
from app.config import Settings
from app.database.models import RegistrationEvent, Vehicle
from app.repositories import VehicleRepository
from app.services.vehicles import VehicleService


@pytest.mark.asyncio
async def test_search_by_vin_collects_multiple_plates(session: object, fake_redis: object) -> None:
    vehicle = Vehicle(
        vin="WVWZZZ3CZHE123456",
        normalized_vin="WVWZZZ3CZHE123456",
        current_plate="KA3333CC",
        normalized_plate="KA3333CC",
        brand="Volkswagen",
        model="Passat",
        year=2017,
        data_source="test",
    )
    session.add(vehicle)  # type: ignore[attr-defined]
    await session.flush()  # type: ignore[attr-defined]
    session.add_all(  # type: ignore[attr-defined]
        [
            RegistrationEvent(
                vehicle_id=vehicle.id,
                vin=vehicle.vin,
                plate="AA1111AA",
                normalized_plate="AA1111AA",
                registration_date=date(2019, 4, 12),
                operation_name="ПЕРЕРЕЄСТРАЦІЯ НА НОВОГО ВЛАСНИКА",
                source="test",
                fingerprint="a" * 64,
            ),
            RegistrationEvent(
                vehicle_id=vehicle.id,
                vin=vehicle.vin,
                plate="KA3333CC",
                normalized_plate="KA3333CC",
                registration_date=date(2024, 2, 17),
                operation_name="ЗАМІНА НОМЕРНОГО ЗНАКУ",
                source="test",
                fingerprint="b" * 64,
            ),
        ]
    )
    await session.commit()  # type: ignore[attr-defined]
    service = VehicleService(VehicleRepository(session), Cache(fake_redis), Settings())  # type: ignore[arg-type]
    reports = await service.search_vin("wvwzzz3czhe123456")
    assert len(reports) == 1
    assert {event.normalized_plate for event in reports[0].events} == {"AA1111AA", "KA3333CC"}
    assert reports[0].analytics.event_count == 2
    assert reports[0].analytics.plate_changes == 1
    assert await service.search_vin("WVWZZZ3CZHE123456") == reports


@pytest.mark.asyncio
async def test_search_by_historical_plate_and_absence(session: object) -> None:
    vehicle = Vehicle(
        normalized_plate="KA3333CC",
        current_plate="KA3333CC",
        brand="BMW",
        model="520D",
        data_source="test",
    )
    session.add(vehicle)  # type: ignore[attr-defined]
    await session.flush()  # type: ignore[attr-defined]
    session.add(
        RegistrationEvent(
            vehicle_id=vehicle.id,
            plate="AA1234BB",
            normalized_plate="AA1234BB",
            source="test",
            fingerprint="c" * 64,
        )
    )  # type: ignore[attr-defined]
    await session.commit()  # type: ignore[attr-defined]
    service = VehicleService(VehicleRepository(session), None, Settings())  # type: ignore[arg-type]
    assert (await service.search_plate("AA1234BB"))[0].vehicle.brand == "BMW"
    assert await service.search_plate("BC9999CB") == []


@pytest.mark.asyncio
async def test_plate_conflict_returns_candidates(session: object) -> None:
    session.add_all(
        [  # type: ignore[attr-defined]
            Vehicle(
                vin="WVWZZZ3CZHE123456",
                normalized_vin="WVWZZZ3CZHE123456",
                current_plate="AA1234BB",
                normalized_plate="AA1234BB",
                brand="VW",
                data_source="test",
            ),
            Vehicle(
                vin="JH4TB2H26CC000000",
                normalized_vin="JH4TB2H26CC000000",
                current_plate="AA1234BB",
                normalized_plate="AA1234BB",
                brand="Honda",
                data_source="test",
            ),
        ]
    )
    await session.commit()  # type: ignore[attr-defined]
    reports = await VehicleService(VehicleRepository(session), None, Settings()).search_plate(
        "AA1234BB"
    )  # type: ignore[arg-type]
    assert len(reports) == 2
    assert all(report.ambiguous for report in reports)
