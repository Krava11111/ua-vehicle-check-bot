from __future__ import annotations

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import RegistrationEvent, Vehicle


class VehicleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _with_events(statement: Select[tuple[Vehicle]]) -> Select[tuple[Vehicle]]:
        return statement.options(selectinload(Vehicle.events))

    async def by_vin(self, normalized_vin: str) -> list[Vehicle]:
        statement = self._with_events(
            select(Vehicle)
            .where(Vehicle.normalized_vin == normalized_vin)
            .order_by(Vehicle.updated_at.desc())
        )
        return list((await self.session.scalars(statement)).unique().all())

    async def by_plate(self, normalized_plate: str) -> list[Vehicle]:
        ids_from_events = select(RegistrationEvent.vehicle_id).where(
            RegistrationEvent.normalized_plate == normalized_plate
        )
        statement = self._with_events(
            select(Vehicle)
            .where(
                or_(Vehicle.normalized_plate == normalized_plate, Vehicle.id.in_(ids_from_events))
            )
            .order_by(Vehicle.updated_at.desc())
        )
        return list((await self.session.scalars(statement)).unique().all())

    async def by_id(self, vehicle_id: int) -> Vehicle | None:
        return await self.session.scalar(
            self._with_events(select(Vehicle).where(Vehicle.id == vehicle_id))
        )

    async def count(self) -> int:
        return int(await self.session.scalar(select(func.count(Vehicle.id))) or 0)
