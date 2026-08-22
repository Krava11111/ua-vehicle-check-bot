from dataclasses import replace
from datetime import date

import pytest
from sqlalchemy import func, select

from app.cache import Cache
from app.database.models import Dataset, RegistrationEvent, Vehicle
from data_importer.importer import VehicleImporter, plate_cluster_conflict
from data_importer.schemas import ImportRow


def row(plate: str = "AA1234BB") -> ImportRow:
    return ImportRow(
        vin="WVWZZZ3CZHE123456",
        plate=plate,
        source_vehicle_id=None,
        registration_date=date(2024, 1, 2),
        operation_code="40",
        operation_name="ПЕРЕРЕЄСТРАЦІЯ",
        region="Київ",
        service_center="ТСЦ 8041",
        owner_type="P",
        brand="Volkswagen",
        model="Passat",
        year=2017,
        color="Чорний",
        vehicle_type="Легковий",
        body_type="Універсал",
        purpose="Загальний",
        fuel_type="Diesel",
        engine_capacity=1968,
        own_weight=1500,
        total_weight=2100,
    )


@pytest.mark.asyncio
async def test_repeat_import_is_idempotent(session_factory: object) -> None:
    importer = VehicleImporter(session_factory)  # type: ignore[arg-type]
    first = await importer.import_rows([[row()]], Dataset(name="first", source_name="test"), "test")
    second = await importer.import_rows(
        [[row()]], Dataset(name="second", source_name="test"), "test"
    )
    assert first.added == 1
    assert second.skipped == 1
    async with session_factory() as session:  # type: ignore[operator]
        assert await session.scalar(select(func.count(Vehicle.id))) == 1
        assert await session.scalar(select(func.count(RegistrationEvent.id))) == 1


@pytest.mark.asyncio
async def test_older_event_does_not_replace_current_plate(session_factory: object) -> None:
    importer = VehicleImporter(session_factory)  # type: ignore[arg-type]
    newer = row("KA3333CC")
    older = row("AA1111AA")
    older.registration_date = date(2019, 4, 12)
    await importer.import_rows(
        [[newer, older]], Dataset(name="ordered", source_name="test"), "test"
    )
    async with session_factory() as session:  # type: ignore[operator]
        vehicle = await session.scalar(select(Vehicle))
        assert vehicle is not None
        assert vehicle.normalized_plate == "KA3333CC"


def test_conflict_detection() -> None:
    vehicle = Vehicle(
        normalized_vin="WVWZZZ3CZHE123456",
        brand="Volkswagen",
        year=2017,
        vehicle_type="Легковий",
        data_source="test",
    )
    conflicting = row()
    conflicting.vin = "JH4TB2H26CC000000"
    assert plate_cluster_conflict(vehicle, conflicting)


@pytest.mark.asyncio
async def test_reused_plate_keeps_incompatible_no_vin_vehicles_separate(
    session_factory: object,
) -> None:
    importer = VehicleImporter(session_factory)  # type: ignore[arg-type]
    q7 = replace(
        row(),
        vin=None,
        brand="Audi",
        model="Q7",
        year=2017,
        fuel_type="Diesel",
        engine_capacity=2967,
        registration_date=date(2020, 2, 1),
    )
    q7_later = replace(q7, registration_date=date(2021, 3, 5), operation_code="410")
    e_tron = replace(
        q7,
        model="E-Tron",
        year=2022,
        fuel_type="Electric",
        engine_capacity=None,
        registration_date=date(2024, 6, 7),
        operation_code="40",
    )

    await importer.import_rows(
        [[q7, q7_later, e_tron]],
        Dataset(name="reused-plate", source_name="test"),
        "test",
    )

    async with session_factory() as session:  # type: ignore[operator]
        vehicles = list((await session.scalars(select(Vehicle))).all())
        assert len(vehicles) == 2
        by_model = {vehicle.model: vehicle for vehicle in vehicles}
        assert set(by_model) == {"Q7", "E-Tron"}
        q7_events = await session.scalar(
            select(func.count(RegistrationEvent.id)).where(
                RegistrationEvent.vehicle_id == by_model["Q7"].id
            )
        )
        e_tron_events = await session.scalar(
            select(func.count(RegistrationEvent.id)).where(
                RegistrationEvent.vehicle_id == by_model["E-Tron"].id
            )
        )
        assert q7_events == 2
        assert e_tron_events == 1


@pytest.mark.asyncio
async def test_import_invalidates_vehicle_and_plate_history_cache(
    session_factory: object, fake_redis: object
) -> None:
    cache = Cache(fake_redis)  # type: ignore[arg-type]
    await fake_redis.set("vehicle:plate:AA1234BB", "cached")  # type: ignore[attr-defined]
    await fake_redis.set("plate_history:AA1234BB", "cached")  # type: ignore[attr-defined]
    await VehicleImporter(session_factory, cache).import_rows(  # type: ignore[arg-type]
        [[row()]], Dataset(name="cache", source_name="test"), "test"
    )
    assert await fake_redis.get("vehicle:plate:AA1234BB") is None  # type: ignore[attr-defined]
    assert await fake_redis.get("plate_history:AA1234BB") is None  # type: ignore[attr-defined]
