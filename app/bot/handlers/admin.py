from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from aiogram import Bot, Router
from aiogram.filters import Command
from aiogram.types import Message
from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import Cache
from app.config import Settings
from app.database.models import (
    ApplicationError,
    Dataset,
    RegistrationEvent,
    SearchHistory,
    SearchType,
    User,
    Vehicle,
)

router = Router(name="admin")


def authorized(message: Message, settings: Settings) -> bool:
    return bool(message.from_user and message.from_user.id in settings.admin_ids)


async def deny(message: Message) -> None:
    await message.answer("Команда недоступна.")


@router.message(Command("admin"))
async def dashboard(message: Message, session: AsyncSession, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    users = await session.scalar(select(func.count(User.id))) or 0
    vehicles = await session.scalar(select(func.count(Vehicle.id))) or 0
    events = await session.scalar(select(func.count(RegistrationEvent.id))) or 0
    total = await session.scalar(select(func.count(SearchHistory.id))) or 0
    counts = dict(
        (kind.value, count)
        for kind, count in (
            await session.execute(
                select(SearchHistory.search_type, func.count()).group_by(SearchHistory.search_type)
            )
        ).all()
    )
    last = await session.scalar(select(Dataset).order_by(Dataset.id.desc()).limit(1))
    errors = (
        await session.scalar(
            select(func.count(ApplicationError.id)).where(
                ApplicationError.created_at >= datetime.now(UTC) - timedelta(days=1)
            )
        )
        or 0
    )
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    plate_history_today = (
        await session.scalar(
            select(func.count(SearchHistory.id)).where(
                SearchHistory.search_type == SearchType.PLATE_HISTORY,
                SearchHistory.created_at >= today,
            )
        )
        or 0
    )
    unique_plate_history_users = (
        await session.scalar(
            select(func.count(func.distinct(SearchHistory.user_id))).where(
                SearchHistory.search_type == SearchType.PLATE_HISTORY
            )
        )
        or 0
    )
    plate_history_not_found = (
        await session.scalar(
            select(func.count(SearchHistory.id)).where(
                SearchHistory.search_type == SearchType.PLATE_HISTORY,
                SearchHistory.found.is_(False),
            )
        )
        or 0
    )
    multiple_plates = (
        select(RegistrationEvent.normalized_plate)
        .where(RegistrationEvent.normalized_plate.is_not(None))
        .group_by(RegistrationEvent.normalized_plate)
        .having(func.count(func.distinct(RegistrationEvent.vehicle_id)) > 1)
        .subquery()
    )
    plates_with_multiple_vehicles = (
        await session.scalar(select(func.count()).select_from(multiple_plates)) or 0
    )
    try:
        size = await session.scalar(
            text("SELECT pg_size_pretty(pg_database_size(current_database()))")
        )
    except Exception:
        await session.rollback()
        size = "н/д"
    last_text = (
        f"{last.status.value}, {last.import_finished_at or last.import_started_at}"
        if last
        else "не выполнялся"
    )
    freshness = str(last.published_at or last.import_finished_at or "н/д") if last else "н/д"
    await message.answer(
        "🛠 <b>Админ-панель</b>\n\n"
        f"👥 Пользователей: {users}\n"
        f"🔎 Проверок по номеру: {counts.get('PLATE', 0)}\n"
        f"🔢 VIN-проверок: {counts.get('VIN', 0)}\n"
        f"🛡 Проверок страховки: {counts.get('INSURANCE', 0)}\n"
        f"🔖 Проверок истории номеров сегодня: {plate_history_today}\n"
        f"🔖 Всего проверок истории номеров: {counts.get('PLATE_HISTORY', 0)}\n"
        f"👥 Уникальных пользователей истории номеров: {unique_plate_history_users}\n"
        f"🔍 Историй номера не найдено: {plate_history_not_found}\n"
        f"🔄 Номеров с несколькими автомобилями: {plates_with_multiple_vehicles}\n"
        f"📋 Всего запросов: {total}\n"
        f"🚘 Автомобилей: {vehicles}\n"
        f"📑 Регистрационных событий: {events}\n"
        f"📦 Последний импорт: {last_text}\n"
        f"🗓 Актуальность: {freshness}\n"
        f"💾 Размер БД: {size}\n"
        f"⚠️ Ошибки за 24 часа: {errors}\n\n"
        "Команды: /user ID, /block ID, /unblock ID, /credit ID N, /import_status, "
        "/import /data/file.zip, /cache_clear QUERY, /broadcast текст"
    )


def command_parts(message: Message) -> list[str]:
    return (message.text or "").split()


@router.message(Command("user"))
async def view_user(message: Message, session: AsyncSession, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    parts = command_parts(message)
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /user TELEGRAM_ID")
        return
    user = await session.scalar(select(User).where(User.telegram_id == int(parts[1])))
    if not user:
        await message.answer("Пользователь не найден.")
        return
    searches = (
        await session.scalar(
            select(func.count(SearchHistory.id)).where(SearchHistory.user_id == user.id)
        )
        or 0
    )
    await message.answer(
        f"👤 {user.telegram_id} @{user.username or '-'}\nЯзык: {user.language}\n"
        f"Заблокирован: {user.is_blocked}\nБаланс: {user.report_balance}\nПроверок: {searches}\n"
        f"Последняя активность: {user.last_active_at}"
    )


async def set_block(
    message: Message, session: AsyncSession, settings: Settings, blocked: bool
) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    parts = command_parts(message)
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Укажите Telegram ID.")
        return
    user = await session.scalar(select(User).where(User.telegram_id == int(parts[1])))
    if not user:
        await message.answer("Пользователь не найден.")
        return
    user.is_blocked = blocked
    await session.commit()
    await message.answer("Пользователь заблокирован." if blocked else "Пользователь разблокирован.")


@router.message(Command("block"))
async def block_user(message: Message, session: AsyncSession, settings: Settings) -> None:
    await set_block(message, session, settings, True)


@router.message(Command("unblock"))
async def unblock_user(message: Message, session: AsyncSession, settings: Settings) -> None:
    await set_block(message, session, settings, False)


@router.message(Command("credit"))
async def credit_user(message: Message, session: AsyncSession, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    parts = command_parts(message)
    if len(parts) != 3 or not parts[1].isdigit() or not parts[2].lstrip("-").isdigit():
        await message.answer("Использование: /credit TELEGRAM_ID КОЛИЧЕСТВО")
        return
    user = await session.scalar(select(User).where(User.telegram_id == int(parts[1])))
    if not user:
        await message.answer("Пользователь не найден.")
        return
    user.report_balance = max(0, user.report_balance + int(parts[2]))
    await session.commit()
    await message.answer(f"Новый баланс: {user.report_balance}")


@router.message(Command("import_status"))
async def import_status(message: Message, session: AsyncSession, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    datasets = list(
        (await session.scalars(select(Dataset).order_by(Dataset.id.desc()).limit(5))).all()
    )
    if not datasets:
        await message.answer("Импорты отсутствуют.")
        return
    await message.answer(
        "\n".join(
            f"#{item.id} {item.status.value}: {item.records_total} строк, {item.error_message or 'без ошибок'}"
            for item in datasets
        )
    )


@router.message(Command("cache_clear"))
async def clear_cache(message: Message, redis: Redis, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    parts = command_parts(message)
    if len(parts) != 2:
        await message.answer("Использование: /cache_clear НОМЕР_ИЛИ_VIN")
        return
    query = parts[1].upper()
    keys = [
        f"vehicle:plate:{query}",
        f"vehicle:vin:{query}",
        f"insurance:plate:{query}",
        f"insurance:vin:{query}",
        f"plate_history:{query}",
    ]
    await Cache(redis).delete(*keys)
    await message.answer("Кеш указанного автомобиля очищен.")


@router.message(Command("import"))
async def start_import(message: Message, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    parts = command_parts(message)
    if len(parts) != 2:
        await message.answer("Использование: /import /data/file.zip")
        return
    path = Path(parts[1])
    data_root = Path("/data").resolve()
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        await message.answer("Файл не найден.")
        return
    if data_root not in resolved.parents:
        await message.answer("Разрешён импорт только из каталога /data.")
        return
    await asyncio.create_subprocess_exec(
        sys.executable, "-m", "data_importer", "--file", str(resolved)
    )
    await message.answer("Импорт запущен в фоне. Статус: /import_status")


@router.message(Command("broadcast"))
async def broadcast(message: Message, bot: Bot, session: AsyncSession, settings: Settings) -> None:
    if not authorized(message, settings):
        await deny(message)
        return
    content = (message.text or "").partition(" ")[2].strip()
    if not content:
        await message.answer("Использование: /broadcast текст")
        return
    ids = list(
        (await session.scalars(select(User.telegram_id).where(User.is_blocked.is_(False)))).all()
    )
    sent = failed = 0
    for telegram_id in ids:
        try:
            await bot.send_message(telegram_id, content)
            sent += 1
        except Exception:
            failed += 1
        await asyncio.sleep(0.04)
    await message.answer(f"Рассылка завершена: доставлено {sent}, ошибок {failed}.")
