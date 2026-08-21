from __future__ import annotations

from collections import defaultdict
from datetime import date

from app.cache import Cache
from app.database.models import RegistrationEvent
from app.domain.normalization import normalize_plate
from app.repositories.registration_events import RegistrationEventRepository
from app.schemas.plate_history import (
    AssignmentConfidence,
    PlateAssignmentPeriod,
    PlateHistoryReport,
)

START_MARKERS = ("ПРИСВО", "ВИДАЧ", "ЗАКРІП", "НАЗНАЧ")
END_MARKERS = ("ЗНЯТ", "СКАСУВАН", "АНУЛЬОВАН")


class PlateHistoryService:
    def __init__(
        self,
        repository: RegistrationEventRepository,
        cache: Cache | None,
        cache_ttl: int = 86400,
    ) -> None:
        self.repository = repository
        self.cache = cache
        self.cache_ttl = cache_ttl

    async def get_plate_history(self, raw_plate: str) -> PlateHistoryReport:
        plate = normalize_plate(raw_plate)
        if not plate:
            raise ValueError("invalid_plate")
        key = f"plate_history:{plate}"
        if self.cache:
            cached = await self.cache.get_json(key)
            if isinstance(cached, dict):
                return PlateHistoryReport.model_validate(cached)
        events = await self.repository.find_all_by_plate(plate)
        groups: dict[str, list[RegistrationEvent]] = defaultdict(list)
        for event in events:
            event_vin = event.vehicle.normalized_vin or event.vin
            identity = f"vin:{event_vin}" if event_vin else f"vehicle:{event.vehicle_id}"
            groups[identity].append(event)
        assignments: list[PlateAssignmentPeriod] = []
        for grouped in groups.values():
            first_event = grouped[0]
            vehicle = first_event.vehicle
            dates = [event.registration_date for event in grouped if event.registration_date]
            texts = [
                f"{event.operation_code or ''} {event.operation_name or ''}".upper()
                for event in grouped
            ]
            explicit_start = any(any(marker in text for marker in START_MARKERS) for text in texts)
            explicit_end = any(any(marker in text for marker in END_MARKERS) for text in texts)
            confidence = (
                AssignmentConfidence.HIGH
                if explicit_start and explicit_end
                else AssignmentConfidence.MEDIUM
                if len(grouped) > 1
                else AssignmentConfidence.LOW
            )
            assignments.append(
                PlateAssignmentPeriod(
                    plate=first_event.plate or plate,
                    normalized_plate=plate,
                    vehicle_id=vehicle.id,
                    vin=vehicle.normalized_vin or first_event.vin,
                    brand=vehicle.brand,
                    model=vehicle.model,
                    year=vehicle.year,
                    color=vehicle.color,
                    vehicle_type=vehicle.vehicle_type,
                    first_seen_at=min(dates) if dates else None,
                    last_seen_at=max(dates) if dates else None,
                    events_count=len(grouped),
                    confidence=confidence,
                    source=", ".join(dict.fromkeys(event.source for event in grouped)),
                )
            )
        assignments.sort(key=lambda item: (item.first_seen_at or date.max, item.vehicle_id))
        short_transition = False
        for left, right in zip(assignments, assignments[1:], strict=False):
            if left.last_seen_at and right.first_seen_at:
                gap = (right.first_seen_at - left.last_seen_at).days
                short_transition = short_transition or 0 <= gap <= 7
        report = PlateHistoryReport(
            plate=events[0].plate if events and events[0].plate else plate,
            normalized_plate=plate,
            assignments=assignments,
            has_multiple_vehicles=len(assignments) > 1,
            has_unresolved_records=any(item.vin is None for item in assignments),
            short_transition_warning=short_transition,
        )
        if self.cache:
            await self.cache.set_json(key, report.model_dump(mode="json"), self.cache_ttl)
        return report
