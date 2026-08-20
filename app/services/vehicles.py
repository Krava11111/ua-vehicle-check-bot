from __future__ import annotations

from app.cache import Cache
from app.config import Settings
from app.domain.normalization import normalize_plate, normalize_vin
from app.repositories.vehicles import VehicleRepository
from app.schemas.vehicle import EventView, VehicleReport, VehicleView
from app.services.analytics import analyze_history


class VehicleService:
    def __init__(
        self, repository: VehicleRepository, cache: Cache | None, settings: Settings
    ) -> None:
        self.repository = repository
        self.cache = cache
        self.settings = settings

    async def search_vin(self, raw_vin: str) -> list[VehicleReport]:
        vin = normalize_vin(raw_vin)
        if not vin:
            raise ValueError("invalid_vin")
        return await self._search("vin", vin)

    async def search_plate(self, raw_plate: str) -> list[VehicleReport]:
        plate = normalize_plate(raw_plate)
        if not plate:
            raise ValueError("invalid_plate")
        return await self._search("plate", plate)

    async def _search(self, kind: str, normalized: str) -> list[VehicleReport]:
        key = f"vehicle:{kind}:{normalized}"
        if self.cache:
            cached = await self.cache.get_json(key)
            if isinstance(cached, list):
                return [VehicleReport.model_validate(item) for item in cached]
        vehicles = await (
            self.repository.by_vin(normalized)
            if kind == "vin"
            else self.repository.by_plate(normalized)
        )
        reports = [
            VehicleReport(
                vehicle=VehicleView.model_validate(vehicle),
                events=[EventView.model_validate(event) for event in vehicle.events],
                analytics=analyze_history(vehicle.events, self.settings),
                matched_by=kind.upper(),
                ambiguous=len(vehicles) > 1,
                candidates=len(vehicles),
            )
            for vehicle in vehicles
        ]
        if self.cache:
            await self.cache.set_json(
                key,
                [item.model_dump(mode="json") for item in reports],
                self.settings.vehicle_cache_ttl,
            )
        return reports
