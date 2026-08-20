from __future__ import annotations

import re
from enum import StrEnum

CYRILLIC_TO_LATIN = str.maketrans(
    {
        "А": "A",
        "В": "B",
        "Е": "E",
        "І": "I",
        "К": "K",
        "М": "M",
        "Н": "H",
        "О": "O",
        "Р": "P",
        "С": "C",
        "Т": "T",
        "Х": "X",
    }
)
PLATE_RE = re.compile(r"^[ABCEHIKMOPTX]{2}\d{4}[ABCEHIKMOPTX]{2}$")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


class QueryKind(StrEnum):
    PLATE = "PLATE"
    VIN = "VIN"
    UNKNOWN = "UNKNOWN"


def normalize_plate(value: str) -> str | None:
    candidate = re.sub(r"[\s\-]+", "", value.strip().upper()).translate(CYRILLIC_TO_LATIN)
    return candidate if PLATE_RE.fullmatch(candidate) else None


def normalize_vin(value: str) -> str | None:
    candidate = re.sub(r"[\s\-]+", "", value.strip().upper())
    return candidate if VIN_RE.fullmatch(candidate) else None


def detect_query(value: str) -> tuple[QueryKind, str | None]:
    vin = normalize_vin(value)
    if vin:
        return QueryKind.VIN, vin
    plate = normalize_plate(value)
    if plate:
        return QueryKind.PLATE, plate
    return QueryKind.UNKNOWN, None
