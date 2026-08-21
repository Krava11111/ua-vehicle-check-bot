from __future__ import annotations

import re
from decimal import Decimal


class BrandNormalizer:
    @staticmethod
    def normalize(value: str | None) -> str | None:
        return re.sub(r"\s+", " ", value.strip()).upper() if value else None


class ModelNormalizer:
    @staticmethod
    def normalize(value: str | None) -> str | None:
        return re.sub(r"[^A-Z0-9]", "", value.upper()) if value else None


class MileageNormalizer:
    MILES_TO_KM = Decimal("1.609344")

    @classmethod
    def to_km(cls, value: int | None, unit: str | None) -> int | None:
        if value is None:
            return None
        normalized_unit = (unit or "km").lower().strip()
        if normalized_unit in {"mi", "mile", "miles"}:
            return int((Decimal(value) * cls.MILES_TO_KM).quantize(Decimal("1")))
        if normalized_unit in {"km", "км", "kilometer", "kilometers"}:
            return int(value)
        return None


class CurrencyNormalizer:
    SYMBOLS = {"$": "USD", "€": "EUR", "₴": "UAH"}

    @classmethod
    def normalize(cls, value: str | None) -> str | None:
        if not value:
            return None
        return cls.SYMBOLS.get(value.strip(), value.strip().upper())[:3]


class DamageNormalizer:
    @staticmethod
    def normalize(value: str | None) -> str | None:
        return re.sub(r"\s+", " ", value.strip()).casefold() if value else None
