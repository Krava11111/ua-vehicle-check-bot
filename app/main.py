from __future__ import annotations

import asyncio

import structlog
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import ErrorEvent
from redis.asyncio import Redis

from app.bot.handlers import admin_router, user_router
from app.bot.middleware import DatabaseMiddleware
from app.config import get_settings
from app.database.models import ApplicationError
from app.database.session import create_engine_and_session
from app.logging import configure_logging
from app.services.auction_history.providers import DisabledAuctionProvider, MockAuctionProvider
from app.services.insurance.disabled_provider import DisabledInsuranceProvider
from app.services.insurance.mock_provider import MockInsuranceProvider
from app.services.marketplace_history.providers import AutoRiaProvider, MockAutoRiaProvider


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    logger = structlog.get_logger()
    token = settings.bot_token.get_secret_value()
    if not token:
        raise RuntimeError("BOT_TOKEN is required")
    engine, session_factory = create_engine_and_session(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    storage = RedisStorage(redis=redis)
    bot = Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher(storage=storage)
    dispatcher["settings"] = settings
    dispatcher["redis"] = redis
    dispatcher["insurance_provider"] = (
        MockInsuranceProvider()
        if settings.insurance_provider == "mock"
        else DisabledInsuranceProvider()
    )
    dispatcher["marketplace_provider"] = (
        MockAutoRiaProvider()
        if settings.auto_ria_enabled and settings.marketplace_provider == "mock"
        else AutoRiaProvider()
    )
    dispatcher["auction_provider"] = (
        MockAuctionProvider()
        if settings.auction_history_enabled and settings.auction_provider == "mock"
        else DisabledAuctionProvider()
    )
    middleware = DatabaseMiddleware(session_factory)
    dispatcher.message.outer_middleware(middleware)
    dispatcher.callback_query.outer_middleware(middleware)
    dispatcher.include_router(admin_router)
    dispatcher.include_router(user_router)

    async def handle_error(event: ErrorEvent) -> bool:
        logger.exception("update_failed", error=str(event.exception))
        async with session_factory() as session:
            session.add(
                ApplicationError(
                    kind=type(event.exception).__name__, message=str(event.exception)[:4000]
                )
            )
            await session.commit()
        for admin_id in settings.admin_ids:
            try:
                await bot.send_message(
                    admin_id, "⚠️ Помилка обробки Telegram update. Дивіться логи."
                )
            except Exception:
                continue
        return True

    dispatcher.errors.register(handle_error)
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        logger.info("bot_started", environment=settings.environment)
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
