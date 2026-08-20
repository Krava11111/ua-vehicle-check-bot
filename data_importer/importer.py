from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.cache import Cache
from app.database.models import Dataset, DatasetStatus, RegistrationEvent, Vehicle
from data_importer.schemas import ImportRow, ImportStats

VEHICLE_FIELDS = (
    "brand",
    "model",
    "year",
    "color",
    "vehicle_type",
    "body_type",
    "purpose",
    "fuel_type",
    "engine_capacity",
    "own_weight",
    "total_weight",
)


class DatasetRequiresReviewError(RuntimeError):
    pass


def fingerprint(row: ImportRow, source: str) -> str:
    parts = (
        row.vin,
        row.plate,
        str(row.registration_date or ""),
        row.operation_code,
        row.operation_name,
        row.region,
        row.service_center,
        source,
    )
    return hashlib.sha256("|".join(value or "" for value in parts).encode()).hexdigest()


def plate_cluster_conflict(vehicle: Vehicle, row: ImportRow) -> bool:
    if vehicle.normalized_vin and row.vin and vehicle.normalized_vin != row.vin:
        return True
    if vehicle.brand and row.brand and vehicle.brand.casefold() != row.brand.casefold():
        return True
    if vehicle.model and row.model and vehicle.model.casefold() != row.model.casefold():
        return True
    if vehicle.year and row.year and abs(vehicle.year - row.year) > 2:
        return True
    if (
        vehicle.vehicle_type
        and row.vehicle_type
        and vehicle.vehicle_type.casefold() != row.vehicle_type.casefold()
    ):
        return True
    if (
        vehicle.body_type
        and row.body_type
        and vehicle.body_type.casefold() != row.body_type.casefold()
    ):
        return True
    if (
        vehicle.fuel_type
        and row.fuel_type
        and vehicle.fuel_type.casefold() != row.fuel_type.casefold()
    ):
        return True
    if vehicle.engine_capacity and row.engine_capacity:
        tolerance = max(300, int(max(vehicle.engine_capacity, row.engine_capacity) * 0.2))
        if abs(vehicle.engine_capacity - row.engine_capacity) > tolerance:
            return True
    return False


class VehicleImporter:
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession], cache: Cache | None = None
    ) -> None:
        self.session_factory = session_factory
        self.cache = cache

    async def import_rows(
        self, batches: Iterable[list[ImportRow]], dataset: Dataset, source: str
    ) -> ImportStats:
        stats = ImportStats()
        async with self.session_factory() as session:
            dataset.status = DatasetStatus.IMPORTING
            dataset.import_started_at = datetime.now(UTC)
            session.add(dataset)
            await session.commit()
            try:
                for batch in batches:
                    for row in batch:
                        stats.total += 1
                        if not row.vin and not row.plate:
                            stats.skipped += 1
                            continue
                        added = await self._merge_row(
                            session, row, source, dataset.import_started_at
                        )
                        if added is None:
                            stats.skipped += 1
                        elif added:
                            stats.added += 1
                        else:
                            stats.updated += 1
                    await session.commit()
                dataset.status = DatasetStatus.COMPLETED
            except Exception as exc:
                await session.rollback()
                dataset.status = DatasetStatus.FAILED
                dataset.error_message = str(exc)[:2000]
                raise
            finally:
                dataset.records_total = stats.total
                dataset.records_added = stats.added
                dataset.records_updated = stats.updated
                dataset.records_skipped = stats.skipped
                dataset.import_finished_at = datetime.now(UTC)
                session.add(dataset)
                await session.commit()
        if self.cache:
            await self.cache.delete_pattern("vehicle:*")
            await self.cache.delete_pattern("plate_history:*")
        return stats

    async def _merge_row(
        self, session: AsyncSession, row: ImportRow, source: str, dataset_updated_at: datetime
    ) -> bool | None:
        event_fingerprint = fingerprint(row, source)
        if await session.scalar(
            select(RegistrationEvent.id).where(RegistrationEvent.fingerprint == event_fingerprint)
        ):
            return None
        vehicle = await self._find_vehicle(session, row)
        created = vehicle is None
        if vehicle is None:
            vehicle = Vehicle(
                source_vehicle_id=row.source_vehicle_id,
                vin=row.vin,
                normalized_vin=row.vin,
                current_plate=row.plate,
                normalized_plate=row.plate,
                data_source=source,
                dataset_updated_at=dataset_updated_at,
            )
            session.add(vehicle)
            await session.flush()
        else:
            if row.vin and not vehicle.normalized_vin:
                vehicle.vin = vehicle.normalized_vin = row.vin
            latest_date = await session.scalar(
                select(func.max(RegistrationEvent.registration_date)).where(
                    RegistrationEvent.vehicle_id == vehicle.id
                )
            )
            plate_is_newer = bool(
                row.registration_date
                and (latest_date is None or row.registration_date >= latest_date)
            )
            if row.plate and (not vehicle.normalized_plate or plate_is_newer):
                vehicle.current_plate = vehicle.normalized_plate = row.plate
            vehicle.dataset_updated_at = dataset_updated_at
        for field in VEHICLE_FIELDS:
            value = getattr(row, field)
            if value is not None:
                setattr(vehicle, field, value)
        session.add(
            RegistrationEvent(
                vehicle_id=vehicle.id,
                vin=row.vin,
                plate=row.plate,
                normalized_plate=row.plate,
                registration_date=row.registration_date,
                operation_code=row.operation_code,
                operation_name=row.operation_name,
                region=row.region,
                service_center=row.service_center,
                owner_type=row.owner_type,
                source=source,
                dataset_updated_at=dataset_updated_at,
                fingerprint=event_fingerprint,
            )
        )
        return created

    async def _find_vehicle(self, session: AsyncSession, row: ImportRow) -> Vehicle | None:
        if row.vin:
            matches = list(
                (
                    await session.scalars(select(Vehicle).where(Vehicle.normalized_vin == row.vin))
                ).all()
            )
            # VIN is the primary stable vehicle identity. Characteristic differences
            # within one VIN are retained for later validation instead of creating a
            # second vehicle or falling back to the reusable plate.
            if matches:
                return matches[0]
        if row.source_vehicle_id:
            match = await session.scalar(
                select(Vehicle).where(Vehicle.source_vehicle_id == row.source_vehicle_id)
            )
            if match and not (
                match.normalized_vin and row.vin and match.normalized_vin != row.vin
            ):
                return match
        if row.plate:
            matches = list(
                (
                    await session.scalars(
                        select(Vehicle).where(Vehicle.normalized_plate == row.plate)
                    )
                ).all()
            )
            compatible = [item for item in matches if not plate_cluster_conflict(item, row)]
            if len(compatible) == 1:
                return compatible[0]
        return None
