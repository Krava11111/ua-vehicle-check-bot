from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiogram.filters import CommandObject

from app.bot.handlers.user import start
from app.config import Settings


@pytest.mark.asyncio
async def test_start_prompts_for_language(session: object) -> None:
    message = SimpleNamespace(
        from_user=SimpleNamespace(id=12345, username="tester", language_code="uk"),
        answer=AsyncMock(),
    )
    await start(
        message,
        session,  # type: ignore[arg-type]
        Settings(admin_ids=(12345,)),
        CommandObject(command="start"),
    )
    message.answer.assert_awaited_once()
    assert "Оберіть мову" in message.answer.await_args.args[0]
