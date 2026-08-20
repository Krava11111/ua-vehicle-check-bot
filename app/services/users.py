from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database.models import User


class UserService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def get_or_create(
        self, telegram_id: int, username: str | None, language: str = "uk"
    ) -> User:
        user = await self.session.scalar(select(User).where(User.telegram_id == telegram_id))
        if user is None:
            user = User(
                telegram_id=telegram_id,
                username=username,
                language=language if language in {"uk", "ru"} else "uk",
                is_admin=telegram_id in self.settings.admin_ids,
            )
            self.session.add(user)
        else:
            user.username = username
            user.last_active_at = datetime.now(UTC)
            user.is_admin = telegram_id in self.settings.admin_ids
        await self.session.commit()
        await self.session.refresh(user)
        return user
