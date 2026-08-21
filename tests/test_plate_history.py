from __future__ import annotations

from datetime import date

from sqlalchemy import select

from app.cache import Cache
from app.config import Settings
from app.database.models import RegistrationEvent, SearchHistory, SearchType, User, Vehicle
from app.domain.normalization import normalize_plate
from app.repositories.registration_events import RegistrationEventRepository
from app.schemas.plate_history import AssignmentConfidence
from app.schemas.vehicle import HistoryAnalytics, VehicleReport, VehicleView
from app.services.access import AccessService, Feature
from app.services.data_coverage import DataCoverageService
from app.services.plate_history import PlateHistoryService
from app.services.reports import ReportService
from app.services.search_history import SearchHistoryService


async def add_vehicle(
    session: object, *, vin: str | None, brand: str, year: int | None = 2018
) -> Vehicle:
    vehicle = Vehicle(
        vin=vin,
        normalized_vin=vin,
        current_plate="AA1234BB",
        normalized_plate="AA1234BB",
        brand=brand,
        model="Model",
        year=year,
        color="Black",
        data_source="test",
    )
    session.add(vehicle)  # type: ignore[attr-defined]
    await session.flush()  # type: ignore[attr-defined]
    return vehicle


def event(
    vehicle: Vehicle, day: date, fingerprint: str, operation: str = "ПЕРЕРЕЄСТРАЦІЯ"
) -> RegistrationEvent:
    return RegistrationEvent(
        vehicle_id=vehicle.id,
        vin=vehicle.normalized_vin,
        plate="AA1234BB",
        normalized_plate="AA1234BB",
        registration_date=day,
        operation_name=operation,
        source="МВС test",
        fingerprint=fingerprint * 64,
    )


async def test_plate_history_one_vehicle_sorting_dates_and_medium_confidence(
    session: object,
) -> None:
    vehicle = await add_vehicle(session, vin="WVWZZZ3CZHE123456", brand="Volkswagen")
    session.add_all(  # type: ignore[attr-defined]
        [
            event(vehicle, date(2024, 5, 3), "a"),
            event(vehicle, date(2020, 3, 12), "b"),
            event(vehicle, date(2022, 9, 17), "c"),
        ]
    )
    await session.commit()  # type: ignore[attr-defined]
    report = await PlateHistoryService(
        RegistrationEventRepository(session),
        None,  # type: ignore[arg-type]
    ).get_plate_history("AA1234BB")
    assert len(report.assignments) == 1
    assignment = report.assignments[0]
    assert assignment.first_seen_at == date(2020, 3, 12)
    assert assignment.last_seen_at == date(2024, 5, 3)
    assert assignment.events_count == 3
    assert assignment.confidence == AssignmentConfidence.MEDIUM
    rendered_ru = "\n".join(ReportService.render_plate_history(report, "ru", 2013))
    rendered_uk = "\n".join(ReportService.render_plate_history(report, "uk", 2013))
    assert "Известный период использования номера по доступным данным" in rendered_ru
    assert "Відомий період використання номера за доступними даними" in rendered_uk
    assert "примерно с 2013 года" in rendered_ru


async def test_plate_history_different_vins_are_not_merged_and_short_transition(
    session: object,
) -> None:
    first = await add_vehicle(session, vin="WVWZZZ3CZHE123456", brand="Volkswagen")
    second = await add_vehicle(session, vin="JH4TB2H26CC000000", brand="Honda")
    session.add_all(  # type: ignore[attr-defined]
        [
            event(first, date(2024, 1, 10), "d"),
            event(first, date(2024, 1, 14), "e"),
            event(second, date(2024, 1, 17), "f"),
        ]
    )
    await session.commit()  # type: ignore[attr-defined]
    report = await PlateHistoryService(
        RegistrationEventRepository(session),
        None,  # type: ignore[arg-type]
    ).get_plate_history("AA1234BB")
    assert len(report.assignments) == 2
    assert {item.vin for item in report.assignments} == {
        "WVWZZZ3CZHE123456",
        "JH4TB2H26CC000000",
    }
    assert report.has_multiple_vehicles and report.short_transition_warning


async def test_plate_history_without_vin_keeps_vehicle_groups_separate(session: object) -> None:
    first = await add_vehicle(session, vin=None, brand="BMW")
    second = await add_vehicle(session, vin=None, brand="Mercedes")
    session.add_all(  # type: ignore[attr-defined]
        [event(first, date(2021, 1, 1), "g"), event(second, date(2023, 1, 1), "h")]
    )
    await session.commit()  # type: ignore[attr-defined]
    report = await PlateHistoryService(
        RegistrationEventRepository(session),
        None,  # type: ignore[arg-type]
    ).get_plate_history("AA1234BB")
    assert len(report.assignments) == 2
    assert report.has_unresolved_records
    assert {item.vehicle_id for item in report.assignments} == {first.id, second.id}


async def test_plate_history_low_and_high_confidence(session: object) -> None:
    low = await add_vehicle(session, vin="WVWZZZ3CZHE123456", brand="VW")
    high = await add_vehicle(session, vin="JH4TB2H26CC000000", brand="Honda")
    session.add_all(  # type: ignore[attr-defined]
        [
            event(low, date(2019, 1, 1), "i"),
            event(high, date(2020, 1, 1), "j", "ПРИСВОЄННЯ НОМЕРНОГО ЗНАКУ"),
            event(high, date(2022, 1, 1), "k", "ЗНЯТТЯ НОМЕРНОГО ЗНАКУ"),
        ]
    )
    await session.commit()  # type: ignore[attr-defined]
    report = await PlateHistoryService(
        RegistrationEventRepository(session),
        None,  # type: ignore[arg-type]
    ).get_plate_history("AA1234BB")
    confidence = {item.vehicle_id: item.confidence for item in report.assignments}
    assert confidence[low.id] == AssignmentConfidence.LOW
    assert confidence[high.id] == AssignmentConfidence.HIGH


async def test_plate_history_not_found_cyrillic_normalization_and_redis_cache(
    session: object, fake_redis: object
) -> None:
    assert normalize_plate("АА 1234 ВВ") == "AA1234BB"
    vehicle = await add_vehicle(session, vin="WVWZZZ3CZHE123456", brand="VW")
    session.add(event(vehicle, date(2024, 1, 1), "l"))  # type: ignore[attr-defined]
    await session.commit()  # type: ignore[attr-defined]
    service = PlateHistoryService(
        RegistrationEventRepository(session),
        Cache(fake_redis),
        86400,  # type: ignore[arg-type]
    )
    first = await service.get_plate_history("АА 1234 ВВ")
    await session.delete(vehicle)  # type: ignore[attr-defined]
    await session.commit()  # type: ignore[attr-defined]
    cached = await service.get_plate_history("AA1234BB")
    missing = await service.get_plate_history("BC9999CB")
    assert cached == first
    assert missing.assignments == []


def vehicle_report(year: int | None) -> VehicleReport:
    return VehicleReport(
        vehicle=VehicleView(id=1, year=year, data_source="test"),
        events=[],
        analytics=HistoryAnalytics(),
        matched_by="VIN",
    )


def test_data_coverage_old_current_boundary_and_unknown_year() -> None:
    service = DataCoverageService(Settings(vehicle_history_start_year=2013))
    old = "\n".join(service.lines(vehicle_report(2008), "ru"))
    boundary = "\n".join(service.lines(vehicle_report(2013), "ru"))
    current = "\n".join(service.lines(vehicle_report(2020), "ru"))
    unknown = "\n".join(service.lines(vehicle_report(None), "ru"))
    assert "старше периода покрытия" in old and "Реальное число" in old
    assert "старше периода покрытия" not in boundary
    assert "старше периода покрытия" not in current
    assert "Год автомобиля неизвестен" in unknown
    rendered = ReportService.render_vehicle(
        vehicle_report(2008), "ru", Settings(vehicle_history_start_year=2013)
    )
    assert "Первое известное событие" in rendered
    assert "Полнота истории" in rendered


async def test_plate_history_access_and_search_history_type(session: object) -> None:
    settings = Settings()
    user = User(telegram_id=123, language="ru", report_balance=0)
    session.add(user)  # type: ignore[attr-defined]
    await session.flush()  # type: ignore[attr-defined]
    assert AccessService(settings).can_access(user, Feature.PLATE_HISTORY)
    await SearchHistoryService(session, settings).record(
        user.id,
        SearchType.PLATE_HISTORY,
        "AA1234BB",
        None,
        True,
        "История номерного знака",
    )
    saved = await session.scalar(select(SearchHistory))  # type: ignore[attr-defined]
    assert saved is not None and saved.search_type == SearchType.PLATE_HISTORY
