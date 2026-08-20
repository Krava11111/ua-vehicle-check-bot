from __future__ import annotations

import hashlib
import hmac

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database.models import SearchHistory, SearchType


class SearchHistoryService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    def hash_query(self, normalized: str) -> str:
        return hmac.new(
            self.settings.query_hash_salt.get_secret_value().encode(),
            normalized.encode(),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    def hint(query: str, search_type: SearchType) -> str:
        if search_type == SearchType.VIN and len(query) >= 7:
            return f"{query[:3]}…{query[-4:]}"
        return query

    async def record(
        self,
        user_id: int,
        search_type: SearchType,
        query: str,
        vehicle_id: int | None,
        found: bool,
        result_label: str | None,
    ) -> None:
        self.session.add(
            SearchHistory(
                user_id=user_id,
                search_type=search_type,
                query_hash=self.hash_query(query),
                query_hint=self.hint(query, search_type),
                vehicle_id=vehicle_id,
                found=found,
                result_label=result_label,
            )
        )
        await self.session.commit()

    async def recent(self, user_id: int, limit: int = 10) -> list[SearchHistory]:
        statement = (
            select(SearchHistory)
            .where(SearchHistory.user_id == user_id)
            .order_by(SearchHistory.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.scalars(statement)).all())
