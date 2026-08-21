from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)


def language_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🇺🇦 Українська", callback_data="lang:uk")],
            [InlineKeyboardButton(text="🇺🇦 Русский", callback_data="lang:ru")],
        ]
    )


def main_keyboard(language: str = "uk") -> ReplyKeyboardMarkup:
    labels = {
        "uk": (
            "🚘 Перевірити за номером",
            "🔢 Перевірити за VIN",
            "🔖 Історія номера",
            "🛡 Перевірити страховку",
            "📋 Мої перевірки",
            "ℹ️ Про сервіс",
        ),
        "ru": (
            "🚘 Проверить по номеру",
            "🔢 Проверить по VIN",
            "🔖 История номера",
            "🛡 Проверить страховку",
            "📋 Мои проверки",
            "ℹ️ О сервисе",
        ),
    }[language if language in {"uk", "ru"} else "uk"]
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=labels[0]), KeyboardButton(text=labels[1])],
            [KeyboardButton(text=labels[2]), KeyboardButton(text=labels[3])],
            [KeyboardButton(text=labels[4]), KeyboardButton(text=labels[5])],
        ],
        resize_keyboard=True,
    )


def report_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📊 Повний звіт", callback_data="report:full")],
            [InlineKeyboardButton(text="📋 Історія", callback_data="report:history")],
            [
                InlineKeyboardButton(
                    text="🔖 Історія цього номера", callback_data="report:plate_history"
                )
            ],
            [InlineKeyboardButton(text="🛡 Перевірити страховку", callback_data="report:insurance")],
            [InlineKeyboardButton(text="🔎 Нова перевірка", callback_data="report:new")],
        ]
    )


def plate_history_keyboard(vehicle_ids: list[int]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"🚘 Перевірити автомобіль #{index}",
                    callback_data=f"plate_vehicle:{vehicle_id}",
                )
            ]
            for index, vehicle_id in enumerate(vehicle_ids[:10], 1)
        ]
        + [[InlineKeyboardButton(text="🔎 Нова перевірка", callback_data="report:new")]]
    )
