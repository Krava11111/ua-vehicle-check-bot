from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import RegistrationEvent


class RegistrationEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_all_by_plate(self, normalized_plate: str) -> list[RegistrationEvent]:
        statement = (
            select(RegistrationEvent)
            .where(RegistrationEvent.normalized_plate == normalized_plate)
            .options(selectinload(RegistrationEvent.vehicle))
            .order_by(RegistrationEvent.registration_date.asc().nulls_last(), RegistrationEvent.id)
        )
        return list((await self.session.scalars(statement)).unique().all())
