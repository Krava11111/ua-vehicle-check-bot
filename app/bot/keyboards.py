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
            "🛡 Перевірити страховку",
            "📋 Мої перевірки",
            "ℹ️ Про сервіс",
        ),
        "ru": (
            "🚘 Проверить по номеру",
            "🔢 Проверить по VIN",
            "🛡 Проверить страховку",
            "📋 Мои проверки",
            "ℹ️ О сервисе",
        ),
    }[language if language in {"uk", "ru"} else "uk"]
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=labels[0]), KeyboardButton(text=labels[1])],
            [KeyboardButton(text=labels[2])],
            [KeyboardButton(text=labels[3]), KeyboardButton(text=labels[4])],
        ],
        resize_keyboard=True,
    )


def report_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📊 Повний звіт", callback_data="report:full")],
            [InlineKeyboardButton(text="📋 Історія", callback_data="report:history")],
            [InlineKeyboardButton(text="🛡 Перевірити страховку", callback_data="report:insurance")],
            [InlineKeyboardButton(text="🔎 Нова перевірка", callback_data="report:new")],
        ]
    )
