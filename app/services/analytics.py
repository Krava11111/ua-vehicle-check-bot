from __future__ import annotations

from datetime import date

from app.config import Settings
from app.database.models import RegistrationEvent
from app.schemas.vehicle import HistoryAnalytics

OWNER_CHANGE_MARKERS = ("ВЛАСНИК", "ПЕРЕРЕЄСТ", "ПЕРЕОФОРМ", "ПРОДАЖ", "КУПІВ")


def _is_owner_change(event: RegistrationEvent) -> bool:
    text = f"{event.operation_code or ''} {event.operation_name or ''}".upper()
    return any(marker in text for marker in OWNER_CHANGE_MARKERS)


def analyze_history(events: list[RegistrationEvent], settings: Settings) -> HistoryAnalytics:
    ordered = sorted(
        (event for event in events if event.registration_date is not None),
        key=lambda event: event.registration_date or date.min,
    )
    dates: list[date] = [event.registration_date for event in ordered if event.registration_date]
    intervals = [(right - left).days for left, right in zip(dates, dates[1:], strict=False)]
    owner_events = [event for event in ordered if _is_owner_change(event)]
    plates = list(
        dict.fromkeys(event.normalized_plate for event in ordered if event.normalized_plate)
    )
    regions = list(dict.fromkeys(event.region for event in ordered if event.region))
    warnings: list[str] = []

    if (
        len(owner_events) >= settings.frequent_owner_change_count
        and owner_events[0].registration_date
    ):
        span = (owner_events[-1].registration_date - owner_events[0].registration_date).days  # type: ignore[operator]
        if span <= settings.frequent_owner_change_months * 31:
            warnings.append("⚠️ Частая смена владельцев")
    owner_dates = [event.registration_date for event in owner_events if event.registration_date]
    if any(
        (right - left).days < settings.fast_resale_days
        for left, right in zip(owner_dates, owner_dates[1:], strict=False)
    ):
        warnings.append("⚠️ Быстрая перепродажа")
    if len(plates) >= settings.frequent_plate_change_count:
        warnings.append("⚠️ Частая смена регистрационных номеров")
    if not dates or dates[0].year > settings.history_coverage_start_year:
        warnings.append("ℹ️ История может быть неполной")

    return HistoryAnalytics(
        first_registration=dates[0] if dates else None,
        last_registration=dates[-1] if dates else None,
        event_count=len(events),
        estimated_owner_changes=len(owner_events),
        plate_changes=max(0, len(plates) - 1),
        regions=regions,
        intervals_days=intervals,
        warnings=warnings,
    )
