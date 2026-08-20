from __future__ import annotations

from aiogram import Bot, F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.keyboards import language_keyboard, main_keyboard, report_keyboard
from app.bot.states import SearchStates
from app.cache import Cache
from app.config import Settings
from app.database.models import SearchType, User
from app.domain.normalization import QueryKind, detect_query
from app.locales import t
from app.repositories import VehicleRepository
from app.schemas.vehicle import VehicleReport
from app.services.access import AccessService, Feature
from app.services.auction_history.base import AuctionProvider
from app.services.auction_history.service import AuctionHistoryService
from app.services.insurance.base import InsuranceProvider
from app.services.insurance.schemas import InsuranceStatus
from app.services.insurance.service import InsuranceService
from app.services.marketplace_history.base import MarketplaceProvider
from app.services.marketplace_history.service import MarketplaceHistoryService
from app.services.rate_limit import RateLimitService
from app.services.reports import ReportService
from app.services.search_history import SearchHistoryService
from app.services.users import UserService
from app.services.vehicle_history.schemas import ExtendedVehicleHistory
from app.services.vehicle_history.service import VehicleHistoryService
from app.services.vehicles import VehicleService

router = Router(name="user")


async def current_user(message: Message, session: AsyncSession, settings: Settings) -> User:
    tg_user = message.from_user
    if not tg_user:
        raise RuntimeError("Message has no Telegram user")
    return await UserService(session, settings).get_or_create(
        tg_user.id, tg_user.username, tg_user.language_code or "uk"
    )


@router.message(CommandStart())
async def start(
    message: Message, session: AsyncSession, settings: Settings, command: CommandObject
) -> None:
    user = await current_user(message, session, settings)
    if command.args in {"uk", "ru"}:
        user.language = command.args
        await session.commit()
    if not command.args:
        await message.answer(t(user.language, "choose_language"), reply_markup=language_keyboard())
    else:
        await message.answer(t(user.language, "welcome"), reply_markup=main_keyboard(user.language))


@router.callback_query(F.data.startswith("lang:"))
async def choose_language(
    callback: CallbackQuery, session: AsyncSession, settings: Settings
) -> None:
    if not isinstance(callback.message, Message) or not callback.from_user:
        return
    user = await UserService(session, settings).get_or_create(
        callback.from_user.id, callback.from_user.username
    )
    language = (callback.data or "lang:uk").split(":", 1)[1]
    user.language = language if language in {"uk", "ru"} else "uk"
    await session.commit()
    await callback.message.edit_text(t(user.language, "welcome"))
    await callback.message.answer("🏠", reply_markup=main_keyboard(user.language))
    await callback.answer()


@router.message(F.text.in_({"🚘 Перевірити за номером", "🚘 Проверить по номеру"}))
async def ask_plate(
    message: Message, state: FSMContext, session: AsyncSession, settings: Settings
) -> None:
    user = await current_user(message, session, settings)
    await state.set_state(SearchStates.plate)
    await message.answer(t(user.language, "ask_plate"))


@router.message(F.text.in_({"🔢 Перевірити за VIN", "🔢 Проверить по VIN"}))
async def ask_vin(
    message: Message, state: FSMContext, session: AsyncSession, settings: Settings
) -> None:
    user = await current_user(message, session, settings)
    await state.set_state(SearchStates.vin)
    await message.answer(t(user.language, "ask_vin"))


@router.message(F.text.in_({"🛡 Перевірити страховку", "🛡 Проверить страховку"}))
async def ask_insurance(
    message: Message, state: FSMContext, session: AsyncSession, settings: Settings
) -> None:
    user = await current_user(message, session, settings)
    await state.set_state(SearchStates.insurance)
    await message.answer(t(user.language, "ask_insurance"))


@router.message(F.text.in_({"ℹ️ Про сервіс", "ℹ️ О сервисе"}))
async def about(message: Message, session: AsyncSession, settings: Settings) -> None:
    user = await current_user(message, session, settings)
    await message.answer(t(user.language, "about"))


@router.message(F.text.in_({"📋 Мої перевірки", "📋 Мои проверки"}))
async def my_searches(message: Message, session: AsyncSession, settings: Settings) -> None:
    user = await current_user(message, session, settings)
    items = await SearchHistoryService(session, settings).recent(user.id)
    if not items:
        await message.answer(t(user.language, "history_empty"))
        return
    lines = ["📋 <b>Мої перевірки</b>" if user.language == "uk" else "📋 <b>Мои проверки</b>"]
    for item in items:
        icon = {SearchType.PLATE: "🚘", SearchType.VIN: "🔢", SearchType.INSURANCE: "🛡"}[
            item.search_type
        ]
        moment = item.created_at.astimezone().strftime("%d.%m.%Y %H:%M")
        label = f" — {item.result_label}" if item.result_label else ""
        lines.append(f"\n{icon} <code>{item.query_hint or '•••'}</code>{label}\n{moment}")
    await message.answer("\n".join(lines))


@router.message(SearchStates.insurance, F.text)
async def insurance_input(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
    redis: Redis,
    insurance_provider: InsuranceProvider,
    bot: Bot,
) -> None:
    user = await current_user(message, session, settings)
    kind, normalized = detect_query(message.text or "")
    if kind == QueryKind.UNKNOWN or not normalized:
        await message.answer(t(user.language, "unknown"))
        return
    if not AccessService(settings).can_access(user, Feature.INSURANCE):
        await message.answer("Функція недоступна.")
        return
    history = SearchHistoryService(session, settings)
    limit = await RateLimitService(redis, settings).check(
        user.telegram_id, history.hash_query(normalized), user.is_admin
    )
    if not limit.allowed:
        if limit.suspicious:
            await alert_admins(bot, settings, user.telegram_id, normalized)
        await message.answer(t(user.language, "rate_limit"))
        return
    service = InsuranceService(insurance_provider, Cache(redis), settings)
    try:
        result = await (
            service.check_vin(normalized)
            if kind == QueryKind.VIN
            else service.check_plate(normalized)
        )
    except (ValueError, RuntimeError):
        await message.answer(t(user.language, "insurance_unavailable"))
        return
    await history.record(
        user.id,
        SearchType.INSURANCE,
        normalized,
        None,
        result.status == InsuranceStatus.ACTIVE,
        None,
    )
    if result.status == InsuranceStatus.UNAVAILABLE:
        text = t(user.language, "insurance_unavailable")
    elif result.source.startswith("Mock"):
        text = f"🛡 <b>Тестова перевірка страхування</b>\n\n{result.message}\n\nДжерело: {result.source}"
    elif result.status == InsuranceStatus.ACTIVE:
        text = (
            f"🛡 <b>Страхування автомобіля</b>\n\n✅ Чинний поліс\n"
            f"Страхова компанія: {result.company}\nПоліс: <code>{result.policy_number}</code>\n"
            f"Діє: {result.valid_from} — {result.valid_to}\nДжерело: {result.source}"
        )
    else:
        text = f"🛡 Дійсний поліс не знайдено.\n\nДжерело: {result.source}"
    text += "\n\nРезультат відображає дані джерела на момент перевірки та не є юридичним висновком."
    await state.clear()
    await message.answer(text, reply_markup=main_keyboard(user.language))


@router.message(F.text)
async def text_search(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
    redis: Redis,
    bot: Bot,
    marketplace_provider: MarketplaceProvider,
    auction_provider: AuctionProvider,
) -> None:
    user = await current_user(message, session, settings)
    if user.is_blocked:
        await message.answer(t(user.language, "blocked"))
        return
    kind, normalized = detect_query(message.text or "")
    forced_state = await state.get_state()
    if forced_state == SearchStates.vin.state and kind != QueryKind.VIN:
        await message.answer(t(user.language, "invalid_vin"))
        return
    if forced_state == SearchStates.plate.state and kind != QueryKind.PLATE:
        await message.answer(t(user.language, "unknown"))
        return
    if kind == QueryKind.UNKNOWN or not normalized:
        await message.answer(t(user.language, "unknown"))
        return
    feature = Feature.VIN if kind == QueryKind.VIN else Feature.PLATE
    if not AccessService(settings).can_access(user, feature):
        await message.answer("Функція недоступна.")
        return
    history = SearchHistoryService(session, settings)
    limit = await RateLimitService(redis, settings).check(
        user.telegram_id, history.hash_query(normalized), user.is_admin
    )
    if not limit.allowed:
        if limit.suspicious:
            await alert_admins(bot, settings, user.telegram_id, normalized)
        await message.answer(t(user.language, "rate_limit"))
        return
    service = VehicleService(VehicleRepository(session), Cache(redis), settings)
    reports = await (
        service.search_vin(normalized)
        if kind == QueryKind.VIN
        else service.search_plate(normalized)
    )
    if not reports:
        await history.record(user.id, SearchType(kind.value), normalized, None, False, None)
        message_key = "database_empty" if await service.repository.count() == 0 else "not_found"
        await message.answer(
            t(user.language, message_key), reply_markup=main_keyboard(user.language)
        )
        await state.clear()
        return
    report = reports[0]
    label = (
        " ".join(value for value in [report.vehicle.brand, report.vehicle.model] if value) or None
    )
    await history.record(
        user.id, SearchType(kind.value), normalized, report.vehicle.id, True, label
    )
    await state.update_data(
        last_report=report.model_dump(mode="json"), last_query=normalized, last_kind=kind.value
    )
    extra = None
    if report.vehicle.normalized_vin and AccessService(settings).can_access(
        user, Feature.FULL_REPORT
    ):
        try:
            extra = await VehicleHistoryService(
                session,
                MarketplaceHistoryService(session, marketplace_provider, Cache(redis), settings),
                AuctionHistoryService(session, auction_provider, Cache(redis), settings),
                settings,
            ).build(report)
        except Exception:
            extra = None
    if extra:
        await state.update_data(last_extended=extra.model_dump(mode="json"))
    await message.answer(
        ReportService.render_vehicle(report, user.language), reply_markup=report_keyboard()
    )


async def alert_admins(bot: Bot, settings: Settings, telegram_id: int, query: str) -> None:
    for admin_id in settings.admin_ids:
        try:
            await bot.send_message(
                admin_id,
                f"⚠️ Підозріла активність користувача <code>{telegram_id}</code>, "
                f"запит <code>{query}</code>.",
            )
        except Exception:
            continue


@router.callback_query(F.data == "report:history")
async def show_history(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    raw = data.get("last_report")
    if callback.message and raw:
        await callback.message.answer(
            ReportService.render_history(VehicleReport.model_validate(raw))
        )
    await callback.answer()


@router.callback_query(F.data == "report:full")
async def show_full_report(
    callback: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    data = await state.get_data()
    raw_report, raw_extra = data.get("last_report"), data.get("last_extended")
    user = await UserService(session, settings).get_or_create(
        callback.from_user.id, callback.from_user.username
    )
    if not AccessService(settings).can_access(user, Feature.FULL_REPORT):
        await callback.answer("Функция недоступна", show_alert=True)
        return
    if callback.message and raw_report and raw_extra:
        for part in ReportService.render_full(
            VehicleReport.model_validate(raw_report),
            ExtendedVehicleHistory.model_validate(raw_extra),
        ):
            await callback.message.answer(part, disable_web_page_preview=True)
    elif callback.message:
        await callback.message.answer(
            "Дополнительная история временно недоступна. Основной отчёт продолжает работать."
        )
    await callback.answer()


@router.callback_query(F.data == "report:insurance")
async def report_insurance(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    query = data.get("last_query")
    if callback.message and query:
        await state.set_state(SearchStates.insurance)
        await callback.message.answer(
            f"🛡 Перевірка: <code>{query}</code>\nНадішліть його ще раз для підтвердження."
        )
    await callback.answer()


@router.callback_query(F.data == "report:new")
async def new_search(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    if callback.message:
        await callback.message.answer("🔎 Надішліть номер або VIN.")
    await callback.answer()
