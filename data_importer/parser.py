from __future__ import annotations

import csv
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import polars as pl

from app.domain.normalization import normalize_plate, normalize_vin
from data_importer.schemas import ImportRow

ALIASES: dict[str, tuple[str, ...]] = {
    "vin": ("vin", "vin_code"),
    "plate": ("n_reg_new", "plate", "number", "reg_number"),
    "source_vehicle_id": ("vehicle_id", "id_vehicle", "record_id"),
    "registration_date": ("d_reg", "registration_date", "date_reg"),
    "operation_code": ("oper_code", "operation_code"),
    "operation_name": ("oper_name", "operation_name"),
    "region": ("reg_addr_koatuu", "region", "oblast"),
    "service_center": ("dep", "service_center"),
    "owner_type": ("person", "owner_type"),
    "brand": ("brand", "make"),
    "model": ("model",),
    "year": ("make_year", "year"),
    "color": ("color",),
    "vehicle_type": ("kind", "vehicle_type"),
    "body_type": ("body", "body_type"),
    "purpose": ("purpose",),
    "fuel_type": ("fuel", "fuel_type"),
    "engine_capacity": ("capacity", "engine_capacity"),
    "own_weight": ("own_weight",),
    "total_weight": ("total_weight",),
}
REQUIRED_GROUPS = ("plate", "vin", "brand", "model")


def column_map(headers: list[str]) -> dict[str, str]:
    lowered = {header.strip().lower(): header for header in headers}
    result: dict[str, str] = {}
    for canonical, aliases in ALIASES.items():
        for alias in aliases:
            if alias in lowered:
                result[canonical] = lowered[alias]
                break
    if not any(key in result for key in ("plate", "vin")):
        raise ValueError("CSV не содержит ни номера, ни VIN")
    if not any(key in result for key in REQUIRED_GROUPS[2:]):
        raise ValueError("CSV не содержит марки или модели")
    return result


def _text(row: dict[str, Any], mapping: dict[str, str], key: str) -> str | None:
    value = row.get(mapping.get(key, ""))
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _integer(row: dict[str, Any], mapping: dict[str, str], key: str) -> int | None:
    value = _text(row, mapping, key)
    if not value:
        return None
    try:
        return int(float(value.replace(",", ".")))
    except ValueError:
        return None


def _date(row: dict[str, Any], mapping: dict[str, str]) -> date | None:
    value = _text(row, mapping, "registration_date")
    if not value:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value[:10], fmt).date()
        except ValueError:
            continue
    return None


def _convert(row: dict[str, Any], mapping: dict[str, str]) -> ImportRow:
    raw_vin = _text(row, mapping, "vin")
    raw_plate = _text(row, mapping, "plate")
    return ImportRow(
        vin=normalize_vin(raw_vin) if raw_vin else None,
        plate=normalize_plate(raw_plate) if raw_plate else None,
        source_vehicle_id=_text(row, mapping, "source_vehicle_id"),
        registration_date=_date(row, mapping),
        operation_code=_text(row, mapping, "operation_code"),
        operation_name=_text(row, mapping, "operation_name"),
        region=_text(row, mapping, "region"),
        service_center=_text(row, mapping, "service_center"),
        owner_type=_text(row, mapping, "owner_type"),
        brand=_text(row, mapping, "brand"),
        model=_text(row, mapping, "model"),
        year=_integer(row, mapping, "year"),
        color=_text(row, mapping, "color"),
        vehicle_type=_text(row, mapping, "vehicle_type"),
        body_type=_text(row, mapping, "body_type"),
        purpose=_text(row, mapping, "purpose"),
        fuel_type=_text(row, mapping, "fuel_type"),
        engine_capacity=_integer(row, mapping, "engine_capacity"),
        own_weight=_integer(row, mapping, "own_weight"),
        total_weight=_integer(row, mapping, "total_weight"),
    )


def parse_batches(
    path: Path, encoding: str, delimiter: str, headers: list[str], batch_size: int = 25_000
) -> Iterator[list[ImportRow]]:
    mapping = column_map(headers)
    if encoding != "utf-8-sig":
        with path.open("r", encoding=encoding, newline="") as stream:
            csv_reader = csv.DictReader(stream, delimiter=delimiter)
            batch: list[ImportRow] = []
            for row in csv_reader:
                batch.append(_convert(row, mapping))
                if len(batch) >= batch_size:
                    yield batch
                    batch = []
            if batch:
                yield batch
        return
    frames = pl.scan_csv(
        path,
        separator=delimiter,
        encoding="utf8",
        infer_schema_length=1000,
        ignore_errors=True,
        truncate_ragged_lines=True,
    ).collect_batches(chunk_size=batch_size)
    for frame in frames:
        result: list[ImportRow] = []
        for row in frame.iter_rows(named=True):
            result.append(_convert(row, mapping))
        yield result


def validate_sample(
    path: Path, encoding: str, delimiter: str, headers: list[str], sample_size: int = 10_000
) -> dict[str, float | int]:
    sample = next(parse_batches(path, encoding, delimiter, headers, sample_size), [])
    if not sample:
        raise ValueError("CSV не содержит строк данных")
    valid_identifiers = sum(bool(row.vin or row.plate) for row in sample)
    valid_ratio = valid_identifiers / len(sample)
    if valid_ratio < 0.5:
        raise ValueError(f"Слишком мало валидных строк в выборке: {valid_ratio:.1%}")
    return {"sample_size": len(sample), "valid_identifier_ratio": valid_ratio}
