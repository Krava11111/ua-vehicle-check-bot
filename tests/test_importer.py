from datetime import date

import pytest
from sqlalchemy import func, select

from app.database.models import Dataset, RegistrationEvent, Vehicle
from data_importer.importer import VehicleImporter, obvious_conflict
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
    assert obvious_conflict(vehicle, conflicting)
