from __future__ import annotations

from enum import StrEnum
from html import escape

from app.schemas.vehicle import VehicleReport


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
