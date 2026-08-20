from __future__ import annotations

from enum import StrEnum
from html import escape

from app.schemas.vehicle import VehicleReport
from app.services.vehicle_history.schemas import ExtendedVehicleHistory


class ReportType(StrEnum):
    BASIC = "BASIC"
    FULL = "FULL"
    VIN = "VIN"
    INSURANCE = "INSURANCE"


class ReportService:
    @staticmethod
    def render_vehicle(report: VehicleReport, language: str = "uk") -> str:
        vehicle, analytics = report.vehicle, report.analytics
        unknown = "немає даних" if language == "uk" else "нет данных"
        title = (
            escape(" ".join(value for value in [vehicle.brand, vehicle.model] if value)) or unknown
        )
        lines = [f"🚘 <b>{title}</b>"]
        if report.ambiguous:
            lines.append(f"\n⚠️ Знайдено можливих збігів: {report.candidates}")
        lines.extend(
            [
                f"\n🔢 VIN: <code>{vehicle.normalized_vin or unknown}</code>",
                f"🔖 Номер: <code>{vehicle.normalized_plate or unknown}</code>",
                f"📅 Рік: {vehicle.year or unknown}",
                f"🎨 Колір: {escape(vehicle.color) if vehicle.color else unknown}",
                f"⛽ Паливо: {escape(vehicle.fuel_type) if vehicle.fuel_type else unknown}",
                f"⚙️ Двигун: {str(vehicle.engine_capacity) + ' см³' if vehicle.engine_capacity else unknown}",
                f"🚗 Тип: {escape(vehicle.vehicle_type) if vehicle.vehicle_type else unknown}",
                f"🧩 Кузов: {escape(vehicle.body_type) if vehicle.body_type else unknown}",
                f"\n📋 Реєстраційних подій: {analytics.event_count}",
                f"Перша відома реєстрація: {analytics.first_registration.strftime('%d.%m.%Y') if analytics.first_registration else unknown}",
                f"Остання операція: {analytics.last_registration.strftime('%d.%m.%Y') if analytics.last_registration else unknown}",
                f"📍 Останній відомий регіон: {escape(analytics.regions[-1]) if analytics.regions else unknown}",
            ]
        )
        if report.matched_by == "PLATE" and not vehicle.normalized_vin:
            lines.append("\n⚠️ Історія побудована за номером і може бути неповною при зміні знаків.")
        lines.extend(f"\n{warning}" for warning in analytics.warnings)
        lines.append(f"\nДжерело: {escape(vehicle.data_source)}")
        return "\n".join(lines)

    @staticmethod
    def render_history(report: VehicleReport) -> str:
        if not report.events:
            return "📋 Реєстраційні події відсутні у доступному наборі даних."
        lines = ["📋 <b>Історія реєстрацій</b>"]
        plate_events: dict[str, str] = {}
        for event in report.events:
            if event.normalized_plate and event.normalized_plate not in plate_events:
                plate_events[event.normalized_plate] = (
                    event.registration_date.strftime("%d.%m.%Y")
                    if event.registration_date
                    else "дата невідома"
                )
        if len(plate_events) > 1:
            lines.append("\n🔖 <b>Історія номерних знаків</b>")
            lines.extend(
                f"\nПерша фіксація {date_text}: <code>{escape(plate)}</code>"
                for plate, date_text in plate_events.items()
            )
            lines.append("\nТочна дата зміни вказується лише за наявними реєстраційними подіями.")
        for event in report.events[-20:]:
            date_text = (
                event.registration_date.strftime("%d.%m.%Y")
                if event.registration_date
                else "дата невідома"
            )
            details = escape(event.operation_name or event.operation_code or "операція не вказана")
            plate = f" · {escape(event.normalized_plate)}" if event.normalized_plate else ""
            region = f" · {escape(event.region)}" if event.region else ""
            lines.append(f"\n{date_text}{plate}{region}\n{details}")
        return "\n".join(lines)

    @staticmethod
    def render_full(report: VehicleReport, extra: ExtendedVehicleHistory) -> list[str]:
        analytics = report.analytics
        damage = next((item.primary_damage for item in extra.auctions if item.primary_damage), None)
        photo_count = sum(len(item.photo_urls) for item in extra.auctions)
        summary = [
            "📊 <b>РЕЗЮМЕ</b>",
            f"🇺🇸 Аукцион США: {'найден' if extra.auctions else 'в подключённых источниках записей не найдено'}",
            f"💥 Повреждения из источника: {escape(damage) if damage else 'нет полученных данных'}",
            f"📸 Ссылок на фото: {photo_count}",
            f"🇺🇦 Регистраций: {analytics.event_count}",
            f"👥 Предполагаемых смен владельца: {analytics.estimated_owner_changes}",
            f"🔖 Известных номеров: {analytics.plate_changes + 1 if report.events else 0}",
            f"💰 Объявлений: {len(extra.marketplace)}",
            f"📊 Записей пробега: {len(extra.mileage_points)}",
            f"⚠️ Предупреждений: {len(extra.odometer_warnings) + len(extra.cross_source_warnings)}",
            "\n🚨 Розыск и 🛡 ОСЦПВ показываются только при результате соответствующего официального модуля; отсутствие данных здесь не является результатом проверки.",
        ]
        messages = ["\n".join(summary), ReportService.render_vehicle(report)]

        registration = [
            "🇺🇦 <b>РЕГИСТРАЦИИ / ВЛАДЕЛЬЦЫ / НОМЕРА / РЕГИОНЫ</b>",
            ReportService.render_history(report),
        ]
        messages.append("\n".join(registration))

        auction = ["🇺🇸 <b>АУКЦИОНЫ США</b>"]
        if not extra.auctions:
            auction.append("В подключённых источниках аукционных записей не найдено.")
        for index, auction_item in enumerate(extra.auctions, 1):
            lines = [
                f"\n{index}️⃣ <b>{escape(auction_item.auction_name or auction_item.provider)}</b>"
            ]
            if auction_item.auction_date:
                lines.append(f"Дата: {auction_item.auction_date:%d.%m.%Y}")
            if auction_item.lot_number:
                lines.append(f"Лот: <code>{escape(auction_item.lot_number)}</code>")
            if auction_item.location:
                lines.append(f"📍 {escape(auction_item.location)}")
            if auction_item.odometer is not None:
                lines.append(
                    f"📊 {auction_item.odometer:,} {escape(auction_item.odometer_unit or '')} ≈ {auction_item.normalized_odometer_km:,} км"
                    if auction_item.normalized_odometer_km is not None
                    else f"📊 {auction_item.odometer:,} {escape(auction_item.odometer_unit or '')}"
                )
            if auction_item.primary_damage:
                lines.append(f"💥 Основное повреждение: {escape(auction_item.primary_damage)}")
            if auction_item.secondary_damage:
                lines.append(f"Дополнительное: {escape(auction_item.secondary_damage)}")
            if auction_item.keys_available is not None:
                lines.append(f"🔑 Ключи: {'есть' if auction_item.keys_available else 'нет'}")
            if auction_item.run_and_drive is not None:
                lines.append(f"🚗 Run & Drive: {'да' if auction_item.run_and_drive else 'нет'}")
            if auction_item.estimated_retail_value is not None:
                lines.append(
                    f"💰 Estimated Retail Value: {auction_item.estimated_retail_value:,.0f} {auction_item.currency or ''}"
                )
            if auction_item.final_bid is not None:
                lines.append(
                    f"💵 Финальная ставка: {auction_item.final_bid:,.0f} {auction_item.currency or ''}"
                )
            if auction_item.photo_urls:
                lines.append(f"📸 Фотографий по ссылкам источника: {len(auction_item.photo_urls)}")
                lines.append(
                    f'📸 <a href="{escape(auction_item.photo_urls[0])}">Открыть первое фото у источника</a>'
                )
            if auction_item.source_url:
                lines.append(f'🔗 <a href="{escape(auction_item.source_url)}">Источник</a>')
            auction.extend(lines)
        if len(extra.auctions) > 1:
            auction.append(
                "\n⚠️ Автомобиль обнаружен в нескольких аукционных событиях. Это не означает автоматически несколько ДТП."
            )
        messages.append("\n".join(auction))

        market = ["🇺🇦 <b>ИСТОРИЯ ОБЪЯВЛЕНИЙ / ЦЕН</b>"]
        if not extra.marketplace:
            market.append("В доступной истории объявлений совпадений не найдено.")
        for listing_item in extra.marketplace:
            market.append(
                f"\n<b>{escape(listing_item.provider)}</b> · {listing_item.first_seen_at:%d.%m.%Y} — {listing_item.last_seen_at:%d.%m.%Y}"
            )
            if listing_item.price is not None:
                market.append(f"Цена: {listing_item.price:,.0f} {listing_item.currency or ''}")
            if listing_item.mileage is not None:
                market.append(
                    f"Пробег: {listing_item.mileage:,} {escape(listing_item.mileage_unit or '')}"
                )
            if listing_item.city:
                market.append(f"📍 {escape(listing_item.city)}")
            market.append(
                "Статус: активно"
                if listing_item.is_active
                else "Статус: объявление снято/больше не обнаруживается источником"
            )
            prices = [
                (snap.observed_at, snap.price, snap.currency)
                for snap in listing_item.snapshots
                if snap.price is not None
            ]
            if len(prices) > 1:
                market.append("💰 История цены:")
                previous = None
                for observed, price, currency in prices:
                    date_text = observed.strftime("%d.%m.%Y")
                    delta = (
                        f" ({float(price) - float(previous):+,.0f})" if previous is not None else ""
                    )
                    market.append(f"{date_text}: {float(price):,.0f} {currency or ''}{delta}")
                    previous = price
                first_price, last_price = prices[0][1], prices[-1][1]
                if first_price and last_price:
                    percent = (last_price - first_price) / first_price * 100
                    market.append(
                        f"Общее изменение: {first_price:,.0f} → {last_price:,.0f} ({percent:+.1f}%)"
                    )
            if listing_item.url:
                market.append(
                    f'🔗 <a href="{escape(listing_item.url)}">Оригинальное объявление</a>'
                )
        if extra.repeated_sales.repeated:
            market.append(
                f"\n🔄 Автомобиль повторно появлялся в продаже. Известных отдельных объявлений: {extra.repeated_sales.periods_count}."
            )
        messages.append("\n".join(market))

        mileage = ["📊 <b>ИСТОРИЯ ПРОБЕГА</b>"]
        if not extra.mileage_points:
            mileage.append("Доступных записей пробега нет.")
        for point in extra.mileage_points:
            original = f"{point.mileage:,} {escape(point.unit)}"
            converted = (
                f" ≈ {point.normalized_mileage_km:,} км"
                if point.unit.lower() not in {"km", "км"}
                else ""
            )
            mileage.append(f"{point.date:%d.%m.%Y} · {escape(point.source)}\n{original}{converted}")
        for warning in extra.odometer_warnings:
            mileage.append(
                f"🔴 {warning.message}: более ранняя запись {warning.previous.normalized_mileage_km:,} км, более поздняя — {warning.current.normalized_mileage_km:,} км."
            )
        messages.append("\n\n".join(mileage))

        analysis = ["⚠️ <b>АНАЛИТИКА</b>"]
        analysis.extend(escape(item.message) for item in extra.cross_source_warnings)
        if extra.history_score:
            analysis.extend(
                [
                    f"\n📊 <b>Аналитический индекс истории: {extra.history_score.value}/100</b>",
                    *extra.history_score.factors,
                    f"\n{extra.history_score.disclaimer}",
                ]
            )
        messages.append("\n".join(analysis))

        timeline = ["📅 <b>ОБЩАЯ ХРОНОЛОГИЯ</b>"]
        for event in extra.timeline[-30:]:
            details = " · ".join(
                value
                for value in [
                    event.description,
                    f"{event.mileage_km:,} км" if event.mileage_km is not None else None,
                    f"{event.price:,.0f} {event.currency or ''}"
                    if event.price is not None
                    else None,
                ]
                if value
            )
            timeline.append(
                f"{event.date:%d.%m.%Y} · {escape(event.source)}\n{escape(event.title)}{f' · {escape(details)}' if details else ''}"
            )
        messages.append("\n\n".join(timeline))
        return [part for message in messages for part in ReportService._split_message(message)]

    @staticmethod
    def _split_message(message: str, limit: int = 4000) -> list[str]:
        if len(message) <= limit:
            return [message]
        parts: list[str] = []
        current: list[str] = []
        length = 0
        for line in message.splitlines():
            addition = len(line) + 1
            if current and length + addition > limit:
                parts.append("\n".join(current))
                current, length = [], 0
            if len(line) > limit:
                parts.extend(line[index : index + limit] for index in range(0, len(line), limit))
            else:
                current.append(line)
                length += addition
        if current:
            parts.append("\n".join(current))
        return parts
