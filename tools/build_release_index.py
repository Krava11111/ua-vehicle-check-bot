from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from collections import OrderedDict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO, TextIO, cast

DATASET_ID = "06779371-308f-42d7-895e-5a39833375f0"
WANTED_DATASET_ID = "ac1a3a9d-512b-446b-9b0c-1383d38ce474"
CKAN_PACKAGE_URL = "https://data.gov.ua/api/3/action/package_show?id={dataset_id}"
SOURCE_PAGE = f"https://data.gov.ua/dataset/{DATASET_ID}"
SOURCE_LABEL = "МВС України / data.gov.ua"
WANTED_SOURCE_PAGE = f"https://data.gov.ua/dataset/{WANTED_DATASET_ID}"
WANTED_SOURCE_LABEL = "Національна поліція України / data.gov.ua"
SCHEMA_VERSION = 4
WANTED_SCHEMA_VERSION = 1
DEFAULT_PREFIX_LENGTH = 3
DEFAULT_MAX_EVENTS = 50
MAX_GITHUB_RELEASE_ASSET_BYTES = 2_000_000_000
MAX_WORKER_SHARD_BYTES = 12 * 1024 * 1024
PLATE_ASSIGNMENT_START_MARKERS = ("ПРИСВО", "ВИДАЧ", "ЗАКРІП", "НАЗНАЧ")
PLATE_ASSIGNMENT_END_MARKERS = ("ЗНЯТ", "СКАСУВАН", "АНУЛЬОВАН")

CYRILLIC_TO_LATIN = str.maketrans(
    {"А": "A", "В": "B", "Е": "E", "І": "I", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X"}
)
PLATE_RE = re.compile(r"^[ABCEHIKMOPTX]{2}\d{4}[ABCEHIKMOPTX]{2}$")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
YEAR_RE = re.compile(r"(?<!\d)(20\d{2}|19\d{2})(?!\d)")

ALIASES: dict[str, tuple[str, ...]] = {
    "vin": ("vin", "vin_code"),
    "plate": ("n_reg_new", "plate", "number", "reg_number"),
    "registration_date": ("d_reg", "registration_date", "date_reg"),
    "operation_code": ("oper_code", "operation_code"),
    "operation_name": ("oper_name", "operation_name"),
    "region": ("reg_addr_koatuu", "region", "oblast"),
    "service_center": ("dep", "service_center"),
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


@dataclass(frozen=True)
class Resource:
    name: str
    url: str
    year: int | None
    modified: str | None = None
    checksum: str | None = None
    resource_id: str | None = None

    def serializable(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "url": self.url,
            "year": self.year,
            "modified": self.modified,
            "checksum": self.checksum,
            "resource_id": self.resource_id,
        }


@dataclass
class CompactRow:
    key: str
    vin: str | None
    plate: str | None
    registration_date: str | None
    operation_code: str | None
    operation_name: str | None
    region: str | None
    service_center: str | None
    brand: str | None
    model: str | None
    year: int | None
    color: str | None
    vehicle_type: str | None
    body_type: str | None
    purpose: str | None
    fuel_type: str | None
    engine_capacity: int | None
    own_weight: int | None
    total_weight: int | None

    def spool_value(self) -> list[Any]:
        return [
            self.key,
            self.vin,
            self.plate,
            self.registration_date,
            self.operation_code,
            self.operation_name,
            self.region,
            self.service_center,
            self.brand,
            self.model,
            self.year,
            self.color,
            self.vehicle_type,
            self.body_type,
            self.purpose,
            self.fuel_type,
            self.engine_capacity,
            self.own_weight,
            self.total_weight,
        ]

    @classmethod
    def from_spool_value(cls, value: list[Any]) -> CompactRow:
        return cls(*value)


def normalize_plate(value: str | None) -> str | None:
    if not value:
        return None
    candidate = re.sub(r"[\s\-]+", "", value.strip().upper()).translate(CYRILLIC_TO_LATIN)
    return candidate if PLATE_RE.fullmatch(candidate) else None


def normalize_vin(value: str | None) -> str | None:
    if not value:
        return None
    candidate = re.sub(r"[\s\-]+", "", value.strip().upper())
    return candidate if VIN_RE.fullmatch(candidate) else None


def shard_for(value: str, prefix_length: int = DEFAULT_PREFIX_LENGTH) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:prefix_length]


def _request_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "autocheck-release-index/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def load_dataset_metadata(
    dataset_id: str = DATASET_ID,
    from_year: int = 2013,
    to_year: int | None = None,
) -> dict[str, Any]:
    to_year = to_year or datetime.now(UTC).year
    payload = _request_json(CKAN_PACKAGE_URL.format(dataset_id=dataset_id))
    if not payload.get("success"):
        raise RuntimeError("data.gov.ua returned an unsuccessful CKAN response")
    package = payload["result"]
    resources: list[Resource] = []
    for raw in package.get("resources", []):
        url = str(raw.get("url") or "").strip()
        name = str(raw.get("name") or raw.get("description") or "resource").strip()
        fmt = str(raw.get("format") or "").lower()
        match = YEAR_RE.search(f"{name} {raw.get('description') or ''}")
        year = int(match.group(1)) if match else None
        if year is None or not from_year <= year <= to_year:
            continue
        if not ("zip" in fmt or "csv" in fmt or url.lower().split("?", 1)[0].endswith((".zip", ".csv"))):
            continue
        resources.append(
            Resource(
                name=name,
                url=url,
                year=year,
                modified=raw.get("last_modified") or raw.get("metadata_modified"),
                checksum=raw.get("hash") or None,
                resource_id=raw.get("id") or None,
            )
        )
    resources.sort(key=lambda item: (item.year or 0, item.name, item.url))
    if not resources:
        raise RuntimeError(f"No CSV/ZIP resources found for years {from_year}-{to_year}")
    fingerprint_payload = json.dumps(
        {
            "schema_version": SCHEMA_VERSION,
            "resources": [item.serializable() for item in resources],
        },
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    fingerprint = hashlib.sha256(fingerprint_payload).hexdigest()
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "dataset_title": package.get("title"),
        "dataset_modified": package.get("metadata_modified"),
        "source_page": f"https://data.gov.ua/dataset/{dataset_id}",
        "source_fingerprint": fingerprint,
        "from_year": from_year,
        "to_year": to_year,
        "resources": [item.serializable() for item in resources],
    }


def load_wanted_metadata(dataset_id: str = WANTED_DATASET_ID) -> dict[str, Any]:
    payload = _request_json(CKAN_PACKAGE_URL.format(dataset_id=dataset_id))
    if not payload.get("success"):
        raise RuntimeError("data.gov.ua returned an unsuccessful CKAN response for wanted vehicles")
    package = payload["result"]
    candidates = [
        raw for raw in package.get("resources", [])
        if str(raw.get("format") or "").lower() == "json"
        and "schema" not in str(raw.get("name") or "").lower()
    ]
    if not candidates:
        raise RuntimeError("CarsWanted JSON resource was not found")
    resource = max(
        candidates,
        key=lambda raw: str(raw.get("last_modified") or raw.get("metadata_modified") or ""),
    )
    serialized = {
        "name": resource.get("name"),
        "url": resource.get("url"),
        "modified": resource.get("last_modified") or resource.get("metadata_modified"),
        "checksum": resource.get("file_hash_sum") or resource.get("hash") or None,
        "resource_id": resource.get("id"),
        "size": resource.get("size"),
    }
    fingerprint = hashlib.sha256(
        json.dumps(serialized, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": WANTED_SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "dataset_title": package.get("title"),
        "dataset_modified": package.get("metadata_modified"),
        "source_page": f"https://data.gov.ua/dataset/{dataset_id}",
        "source_fingerprint": fingerprint,
        "resource": serialized,
    }


def local_metadata(paths: Iterable[Path]) -> dict[str, Any]:
    resources: list[dict[str, Any]] = []
    for path in paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        resources.append(
            Resource(path.name, path.resolve().as_uri(), None, checksum=digest).serializable()
        )
    payload = json.dumps(resources, sort_keys=True).encode("utf-8")
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": "local",
        "dataset_title": "Local vehicle fixtures",
        "dataset_modified": None,
        "source_page": SOURCE_PAGE,
        "source_fingerprint": hashlib.sha256(payload).hexdigest(),
        "from_year": None,
        "to_year": None,
        "resources": resources,
    }


class LruWriters:
    def __init__(self, root: Path, max_open: int = 64) -> None:
        self.root = root
        self.max_open = max_open
        self.handles: OrderedDict[str, TextIO] = OrderedDict()
        root.mkdir(parents=True, exist_ok=True)

    def write(self, shard: str, value: Any) -> None:
        handle = self.handles.pop(shard, None)
        if handle is None:
            if len(self.handles) >= self.max_open:
                _, old = self.handles.popitem(last=False)
                old.close()
            handle = (self.root / f"{shard}.jsonl").open("a", encoding="utf-8", newline="\n")
        self.handles[shard] = handle
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")

    def close(self) -> None:
        for handle in self.handles.values():
            handle.close()
        self.handles.clear()


def _detect_encoding(sample: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            sample.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "utf-8"


def _detect_delimiter(text: str) -> str:
    try:
        return csv.Sniffer().sniff(text, delimiters=",;\t|").delimiter
    except csv.Error:
        return ";" if text.count(";") > text.count(",") else ","


def _column_map(headers: list[str]) -> dict[str, str]:
    lowered = {header.strip().lower(): header for header in headers if header}
    result: dict[str, str] = {}
    for canonical, aliases in ALIASES.items():
        for alias in aliases:
            if alias in lowered:
                result[canonical] = lowered[alias]
                break
    if not any(key in result for key in ("plate", "vin")):
        raise ValueError("CSV has neither a supported plate nor VIN column")
    return result


def _text(row: dict[str, str], mapping: dict[str, str], key: str) -> str | None:
    value = row.get(mapping.get(key, ""))
    text = str(value).strip() if value is not None else ""
    return text or None


def _integer(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(float(value.replace(",", ".")))
    except ValueError:
        return None


def _iso_date(value: str | None) -> str | None:
    if not value:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _compact_row(row: dict[str, str], mapping: dict[str, str]) -> CompactRow | None:
    vin = normalize_vin(_text(row, mapping, "vin"))
    plate = normalize_plate(_text(row, mapping, "plate"))
    if not vin and not plate:
        return None
    key = vin or f"P:{plate}"
    return CompactRow(
        key=key,
        vin=vin,
        plate=plate,
        registration_date=_iso_date(_text(row, mapping, "registration_date")),
        operation_code=_text(row, mapping, "operation_code"),
        operation_name=_text(row, mapping, "operation_name"),
        region=_text(row, mapping, "region"),
        service_center=_text(row, mapping, "service_center"),
        brand=_text(row, mapping, "brand"),
        model=_text(row, mapping, "model"),
        year=_integer(_text(row, mapping, "year")),
        color=_text(row, mapping, "color"),
        vehicle_type=_text(row, mapping, "vehicle_type"),
        body_type=_text(row, mapping, "body_type"),
        purpose=_text(row, mapping, "purpose"),
        fuel_type=_text(row, mapping, "fuel_type"),
        engine_capacity=_integer(_text(row, mapping, "engine_capacity")),
        own_weight=_integer(_text(row, mapping, "own_weight")),
        total_weight=_integer(_text(row, mapping, "total_weight")),
    )


def _iter_csv_stream(binary: BinaryIO) -> Iterator[CompactRow]:
    sample = binary.read(65536)
    encoding = _detect_encoding(sample)
    sample_text = sample.decode(encoding, errors="replace")
    delimiter = _detect_delimiter(sample_text)
    prefixed = _PrefixedStream(sample, binary)
    stream = io.TextIOWrapper(io.BufferedReader(prefixed), encoding=encoding, newline="")  # type: ignore[type-var]
    reader = csv.DictReader(stream, delimiter=delimiter)
    mapping = _column_map(list(reader.fieldnames or []))
    for raw in reader:
        row = _compact_row(raw, mapping)
        if row:
            yield row


def _looks_like_supported_csv(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> bool:
    """Detect CSV content when an official ZIP has a corrupted/non-ASCII file extension."""
    if member.is_dir() or member.file_size <= 0:
        return False
    with archive.open(member) as stream:
        sample = stream.read(65536)
    if not sample or sample.count(b"\x00") > len(sample) // 20:
        return False
    encoding = _detect_encoding(sample)
    text = sample.decode(encoding, errors="replace")
    delimiter = _detect_delimiter(text)
    try:
        headers = next(csv.reader(io.StringIO(text), delimiter=delimiter))
        _column_map(headers)
    except (StopIteration, csv.Error, ValueError):
        return False
    return True


class _PrefixedStream(io.RawIOBase):
    def __init__(self, prefix: bytes, stream: BinaryIO) -> None:
        self.prefix = memoryview(prefix)
        self.position = 0
        self.stream = stream

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        target = memoryview(buffer)
        written = 0
        if self.position < len(self.prefix):
            count = min(len(target), len(self.prefix) - self.position)
            target[:count] = self.prefix[self.position : self.position + count]
            self.position += count
            written += count
        if written < len(target):
            chunk = self.stream.read(len(target) - written)
            if chunk:
                target[written : written + len(chunk)] = chunk
                written += len(chunk)
        return written


def _iter_rows(path: Path) -> Iterator[CompactRow]:
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            members = [item for item in archive.infolist() if not item.is_dir() and item.filename.lower().endswith(".csv")]
            if not members:
                members = [
                    item for item in archive.infolist()
                    if _looks_like_supported_csv(archive, item)
                ]
            if not members:
                names = ", ".join(ascii(item.filename) for item in archive.infolist()[:10])
                raise ValueError(f"No supported CSV content in {path.name}; members: {names}")
            for member in members:
                with archive.open(member) as stream:
                    yield from _iter_csv_stream(cast(BinaryIO, stream))
    else:
        with path.open("rb") as stream:
            yield from _iter_csv_stream(stream)


def _download(resource: dict[str, Any], target_dir: Path) -> Path:
    url = str(resource["url"])
    if url.startswith("file:"):
        from urllib.parse import unquote, urlparse

        return Path(unquote(urlparse(url).path.lstrip("/"))) if os.name == "nt" else Path(unquote(urlparse(url).path))
    lowered_url = url.lower().split("?", 1)[0]
    suffix = ".zip" if ".zip" in lowered_url else ".json" if ".json" in lowered_url else ".csv"
    target = target_dir / f"{resource.get('year') or 'resource'}-{hashlib.sha256(url.encode()).hexdigest()[:8]}{suffix}"
    request = urllib.request.Request(url, headers={"User-Agent": "autocheck-release-index/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    return target


def _event(row: CompactRow) -> list[Any]:
    return [
        row.registration_date,
        row.operation_code,
        row.operation_name,
        row.plate,
        row.region,
        row.service_center,
        row.color,
        row.fuel_type,
        row.engine_capacity,
        row.body_type,
        row.purpose,
        row.own_weight,
        row.total_weight,
        row.vehicle_type,
    ]


def _event_key(event: list[Any]) -> str:
    return "\x1f".join(str(item or "") for item in event)


def _new_vehicle(row: CompactRow) -> dict[str, Any]:
    return {
        "v": row.vin,
        "p": row.plate,
        "b": row.brand,
        "m": row.model,
        "y": row.year,
        "c": row.color,
        "k": row.vehicle_type,
        "bt": row.body_type,
        "pu": row.purpose,
        "f": row.fuel_type,
        "ec": row.engine_capacity,
        "ow": row.own_weight,
        "tw": row.total_weight,
        "e": [],
        "_latest": row.registration_date or "",
        "_events": set(),
    }


def _merge_vehicle(vehicle: dict[str, Any], row: CompactRow) -> None:
    event = _event(row)
    event_key = _event_key(event)
    if event_key not in vehicle["_events"]:
        vehicle["_events"].add(event_key)
        vehicle["e"].append(event)
    row_date = row.registration_date or ""
    if row_date >= vehicle["_latest"]:
        vehicle["_latest"] = row_date
        for key, value in (
            ("v", row.vin), ("p", row.plate), ("b", row.brand), ("m", row.model),
            ("y", row.year), ("c", row.color), ("k", row.vehicle_type), ("bt", row.body_type),
            ("pu", row.purpose), ("f", row.fuel_type), ("ec", row.engine_capacity),
            ("ow", row.own_weight), ("tw", row.total_weight),
        ):
            if value is not None:
                vehicle[key] = value


def _plate_spool_value(row: CompactRow) -> list[Any]:
    return [
        row.plate,
        row.key,
        row.vin,
        row.registration_date,
        row.operation_code,
        row.operation_name,
        row.brand,
        row.model,
        row.year,
        row.color,
        row.vehicle_type,
        row.service_center,
    ]


def _plate_assignment_identity(value: list[Any]) -> str:
    _, vehicle_key, vin, registration_date, operation_code, operation_name, brand, model, year, color, vehicle_type, service_center = value
    if vin:
        return f"vin:{vin}"
    characteristics = [brand, model, year, color, vehicle_type]
    if any(item is not None for item in characteristics):
        raw = "|".join(str(item or "").strip().casefold() for item in characteristics)
        return f"unknown:{hashlib.sha256(raw.encode()).hexdigest()[:20]}"
    raw = "|".join(
        str(item or "")
        for item in [vehicle_key, registration_date, operation_code, operation_name, service_center]
    )
    return f"unresolved:{hashlib.sha256(raw.encode()).hexdigest()[:20]}"


def _merge_plate_assignment(assignments: dict[str, dict[str, Any]], value: list[Any]) -> None:
    plate, vehicle_key, vin, registration_date, operation_code, operation_name, brand, model, year, color, vehicle_type, _ = value
    identity = _plate_assignment_identity(value)
    text = f"{operation_code or ''} {operation_name or ''}".upper()
    assignment = assignments.setdefault(
        identity,
        {
            "vehicle_key": vehicle_key,
            "vin": vin,
            "brand": brand,
            "model": model,
            "year": year,
            "color": color,
            "vehicle_type": vehicle_type,
            "first": registration_date,
            "last": registration_date,
            "count": 0,
            "start": False,
            "end": False,
            "latest": registration_date or "",
            "plate": plate,
        },
    )
    assignment["count"] += 1
    if registration_date:
        assignment["first"] = min(assignment["first"] or registration_date, registration_date)
        assignment["last"] = max(assignment["last"] or registration_date, registration_date)
    assignment["start"] = assignment["start"] or any(
        marker in text for marker in PLATE_ASSIGNMENT_START_MARKERS
    )
    assignment["end"] = assignment["end"] or any(
        marker in text for marker in PLATE_ASSIGNMENT_END_MARKERS
    )
    if (registration_date or "") >= assignment["latest"]:
        assignment["latest"] = registration_date or ""
        for key, item in (
            ("vehicle_key", vehicle_key),
            ("vin", vin),
            ("brand", brand),
            ("model", model),
            ("year", year),
            ("color", color),
            ("vehicle_type", vehicle_type),
        ):
            if item is not None:
                assignment[key] = item


def _serialize_plate_assignment(value: dict[str, Any]) -> list[Any]:
    confidence = "HIGH" if value["start"] and value["end"] else "MEDIUM" if value["count"] > 1 else "LOW"
    return [
        value["vehicle_key"],
        value["vin"],
        value["brand"],
        value["model"],
        value["year"],
        value["color"],
        value["vehicle_type"],
        value["first"],
        value["last"],
        value["count"],
        confidence,
    ]


def _gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as zipped:
            payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
            zipped.write(payload)


def _pack_group_archives(
    assets: Path,
    archives: Path,
    archive_prefix: str = "index",
) -> dict[str, int]:
    """Pack gzip shards without recompressing them so a Worker can HTTP-range-read one member."""
    archives.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, int] = {}
    for group_dir in sorted(path for path in assets.iterdir() if path.is_dir()):
        archive_path = archives / f"{archive_prefix}-{group_dir.name}.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
            for shard_path in sorted(group_dir.glob("*.json.gz")):
                if shard_path.stat().st_size > MAX_WORKER_SHARD_BYTES:
                    raise RuntimeError(
                        f"{shard_path.name} exceeds the Worker shard limit; increase --prefix-length"
                    )
                archive.write(shard_path, arcname=shard_path.name)
        size = archive_path.stat().st_size
        if size >= MAX_GITHUB_RELEASE_ASSET_BYTES:
            raise RuntimeError(
                f"{archive_path.name} is {size} bytes, above GitHub's per-asset limit; "
                "increase --prefix-length or split the group layout"
            )
        sizes[group_dir.name] = size
    return sizes


def build_index(
    metadata: dict[str, Any],
    output_dir: Path,
    repository: str,
    prefix_length: int = DEFAULT_PREFIX_LENGTH,
    max_events: int = DEFAULT_MAX_EVENTS,
) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{1,4}", "f" * prefix_length):
        raise ValueError("prefix length must be between 1 and 4")
    work = Path(tempfile.mkdtemp(prefix="vehicle-release-index-"))
    vehicle_writers = LruWriters(work / "vehicle-spool")
    plate_writers = LruWriters(work / "plate-spool")
    rows_seen = 0
    valid_rows = 0
    try:
        downloads = work / "downloads"
        downloads.mkdir()
        resource_total = len(metadata["resources"])
        for resource_index, resource in enumerate(metadata["resources"], start=1):
            print(
                f"[{resource_index}/{resource_total}] Processing "
                f"{resource.get('name') or resource.get('url')} ({resource.get('year') or 'unknown year'})",
                flush=True,
            )
            path = _download(resource, downloads)
            resource_rows = 0
            for row in _iter_rows(path):
                rows_seen += 1
                valid_rows += 1
                resource_rows += 1
                vehicle_writers.write(shard_for(row.key, prefix_length), row.spool_value())
                if row.plate:
                    plate_writers.write(
                        shard_for(row.plate, prefix_length), _plate_spool_value(row)
                    )
            print(f"[{resource_index}/{resource_total}] Accepted {resource_rows:,} rows", flush=True)
            if not str(resource["url"]).startswith("file:"):
                path.unlink(missing_ok=True)
        vehicle_writers.close()
        plate_writers.close()

        assets = output_dir / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        vehicle_count = 0
        event_count = 0
        plate_count = 0
        nonempty_vehicle_shards = 0
        nonempty_plate_shards = 0
        plate_assignment_count = 0

        for spool in sorted((work / "vehicle-spool").glob("*.jsonl")):
            vehicles: dict[str, dict[str, Any]] = {}
            with spool.open("r", encoding="utf-8") as stream:
                for line in stream:
                    row = CompactRow.from_spool_value(json.loads(line))
                    vehicle = vehicles.setdefault(row.key, _new_vehicle(row))
                    _merge_vehicle(vehicle, row)
            for vehicle in vehicles.values():
                vehicle["e"].sort(key=lambda item: item[0] or "")
                if max_events > 0:
                    vehicle["e"] = vehicle["e"][-max_events:]
                event_count += len(vehicle["e"])
                vehicle.pop("_latest", None)
                vehicle.pop("_events", None)
            shard = spool.stem
            _gzip_json(assets / shard[0] / f"vehicles-{shard}.json.gz", vehicles)
            vehicle_count += len(vehicles)
            nonempty_vehicle_shards += 1

        for spool in sorted((work / "plate-spool").glob("*.jsonl")):
            plates: dict[str, set[str]] = {}
            histories: dict[str, dict[str, dict[str, Any]]] = {}
            with spool.open("r", encoding="utf-8") as stream:
                for line in stream:
                    value = json.loads(line)
                    plate, key = value[0], value[1]
                    plates.setdefault(plate, set()).add(key)
                    _merge_plate_assignment(histories.setdefault(plate, {}), value)
            serialized = {plate: sorted(keys) for plate, keys in plates.items()}
            serialized_history = {
                plate: sorted(
                    (_serialize_plate_assignment(item) for item in assignments.values()),
                    key=lambda item: (item[7] or "9999", item[0]),
                )
                for plate, assignments in histories.items()
            }
            shard = spool.stem
            _gzip_json(assets / shard[0] / f"plates-{shard}.json.gz", serialized)
            _gzip_json(
                assets / shard[0] / f"plate-history-{shard}.json.gz",
                serialized_history,
            )
            plate_count += len(serialized)
            plate_assignment_count += sum(len(items) for items in serialized_history.values())
            nonempty_plate_shards += 1

        archives = output_dir / "archives"
        archive_sizes = _pack_group_archives(assets, archives)
        shutil.rmtree(assets)

        stamp = re.sub(r"[^0-9]", "", str(metadata.get("dataset_modified") or ""))[:14]
        if not stamp:
            stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        version = f"{stamp}-{metadata['source_fingerprint'][:12]}"
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "version": version,
            "generated_at": datetime.now(UTC).isoformat(),
            "dataset_updated_at": metadata.get("dataset_modified"),
            "source_fingerprint": metadata["source_fingerprint"],
            "source_label": SOURCE_LABEL,
            "source_url": metadata.get("source_page") or SOURCE_PAGE,
            "repository": repository,
            "shard_prefix_length": prefix_length,
            "max_events_per_vehicle": max_events,
            "history_start_year": metadata.get("from_year") or 2013,
            "plate_history_available": True,
            "archive_url_template": f"https://github.com/{repository}/releases/download/vehicle-data-{{version}}-{{group}}/index-{{group}}.zip",
            "counts": {
                "input_rows": rows_seen,
                "valid_rows": valid_rows,
                "vehicles": vehicle_count,
                "plates": plate_count,
                "events": event_count,
                "vehicle_shards": nonempty_vehicle_shards,
                "plate_shards": nonempty_plate_shards,
                "plate_assignments": plate_assignment_count,
                "archives": len(archive_sizes),
                "archive_bytes": sum(archive_sizes.values()),
            },
            "resources": metadata["resources"],
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return manifest
    finally:
        vehicle_writers.close()
        plate_writers.close()
        shutil.rmtree(work, ignore_errors=True)


def _wanted_text(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    text = str(value).strip() if value is not None else ""
    return text or None


def _wanted_date(value: str | None) -> str | None:
    if not value:
        return None
    return _iso_date(value[:10])


def build_wanted_index(
    metadata: dict[str, Any],
    output_dir: Path,
    repository: str,
    prefix_length: int = DEFAULT_PREFIX_LENGTH,
) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{1,4}", "f" * prefix_length):
        raise ValueError("prefix length must be between 1 and 4")
    work = Path(tempfile.mkdtemp(prefix="wanted-release-index-"))
    writers = LruWriters(work / "wanted-spool")
    records_seen = 0
    indexed_records = 0
    identifier_links = 0
    try:
        downloads = work / "downloads"
        downloads.mkdir()
        path = _download(metadata["resource"], downloads)
        with path.open("r", encoding="utf-8-sig") as stream:
            payload = json.load(stream)
        if not isinstance(payload, list):
            raise ValueError("CarsWanted JSON root must be an array")
        for raw in payload:
            records_seen += 1
            if not isinstance(raw, dict):
                continue
            plate = normalize_plate(_wanted_text(raw, "vehiclenumber"))
            body_vin = normalize_vin(_wanted_text(raw, "bodynumber"))
            chassis_vin = normalize_vin(_wanted_text(raw, "chassisnumber"))
            record_identifiers = sorted({value for value in (plate, body_vin, chassis_vin) if value})
            if not record_identifiers:
                continue
            record = [
                _wanted_text(raw, "id"),
                plate,
                body_vin,
                chassis_vin,
                _wanted_text(raw, "brand"),
                _wanted_text(raw, "model"),
                _wanted_text(raw, "color"),
                _wanted_date(_wanted_text(raw, "illegalseizuredate")),
                _wanted_date(_wanted_text(raw, "insertdate")),
                _wanted_text(raw, "cartype"),
            ]
            indexed_records += 1
            for identifier in record_identifiers:
                writers.write(shard_for(identifier, prefix_length), [identifier, record])
                identifier_links += 1
        writers.close()

        assets = output_dir / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        identifiers_count = 0
        nonempty_shards = 0
        for spool in sorted((work / "wanted-spool").glob("*.jsonl")):
            shard_identifiers: dict[str, dict[str, list[Any]]] = {}
            with spool.open("r", encoding="utf-8") as stream:
                for line in stream:
                    identifier, record = json.loads(line)
                    record_key = str(record[0] or _event_key(record))
                    shard_identifiers.setdefault(identifier, {})[record_key] = record
            serialized = {
                identifier: [records[key] for key in sorted(records)]
                for identifier, records in shard_identifiers.items()
            }
            shard = spool.stem
            _gzip_json(assets / shard[0] / f"wanted-{shard}.json.gz", serialized)
            identifiers_count += len(serialized)
            nonempty_shards += 1

        archives = output_dir / "archives"
        archive_sizes = _pack_group_archives(assets, archives, "wanted-index")
        shutil.rmtree(assets)
        modified = str(metadata.get("resource", {}).get("modified") or metadata.get("dataset_modified") or "")
        stamp = re.sub(r"[^0-9]", "", modified)[:14] or datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        version = f"{stamp}-{metadata['source_fingerprint'][:12]}"
        manifest = {
            "schema_version": WANTED_SCHEMA_VERSION,
            "version": version,
            "generated_at": datetime.now(UTC).isoformat(),
            "dataset_updated_at": metadata.get("resource", {}).get("modified") or metadata.get("dataset_modified"),
            "source_fingerprint": metadata["source_fingerprint"],
            "source_label": WANTED_SOURCE_LABEL,
            "source_url": metadata.get("source_page") or WANTED_SOURCE_PAGE,
            "shard_prefix_length": prefix_length,
            "archive_url_template": (
                f"https://github.com/{repository}/releases/download/"
                "wanted-data-{version}/wanted-index-{group}.zip"
            ),
            "counts": {
                "input_records": records_seen,
                "indexed_records": indexed_records,
                "identifiers": identifiers_count,
                "identifier_links": identifier_links,
                "shards": nonempty_shards,
                "archives": len(archive_sizes),
                "archive_bytes": sum(archive_sizes.values()),
            },
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return manifest
    finally:
        writers.close()
        shutil.rmtree(work, ignore_errors=True)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def command_metadata(args: argparse.Namespace) -> int:
    metadata = load_dataset_metadata(args.dataset_id, args.from_year, args.to_year)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def command_wanted_metadata(args: argparse.Namespace) -> int:
    metadata = load_wanted_metadata(args.dataset_id)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def command_changed(args: argparse.Namespace) -> int:
    metadata = _read_json(args.metadata)
    current = _read_json(args.manifest)
    changed = not metadata or not current or metadata.get("source_fingerprint") != current.get("source_fingerprint")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write(f"changed={'true' if changed else 'false'}\n")
    else:
        print("true" if changed else "false")
    return 0


def command_wanted_changed(args: argparse.Namespace) -> int:
    metadata = _read_json(args.metadata)
    current = _read_json(args.manifest)
    wanted = current.get("wanted") if current else None
    changed = (
        not metadata
        or not isinstance(wanted, dict)
        or metadata.get("source_fingerprint") != wanted.get("source_fingerprint")
    )
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write(f"changed={'true' if changed else 'false'}\n")
    else:
        print("true" if changed else "false")
    return 0


def command_build(args: argparse.Namespace) -> int:
    metadata: dict[str, Any] | None
    if args.input:
        metadata = local_metadata(args.input)
    elif args.metadata:
        metadata = _read_json(args.metadata)
        if metadata is None:
            raise SystemExit("Metadata file is missing or invalid")
    else:
        metadata = load_dataset_metadata(args.dataset_id, args.from_year, args.to_year)
    if metadata is None:
        raise SystemExit("Metadata file is missing or invalid")
    manifest = build_index(metadata, args.output, args.repository, args.prefix_length, args.max_events)
    print(json.dumps({"version": manifest["version"], "counts": manifest["counts"]}, ensure_ascii=False))
    return 0


def command_build_wanted(args: argparse.Namespace) -> int:
    metadata = _read_json(args.metadata) if args.metadata else load_wanted_metadata(args.dataset_id)
    if metadata is None:
        raise SystemExit("Wanted metadata file is missing or invalid")
    manifest = build_wanted_index(metadata, args.output, args.repository, args.prefix_length)
    print(json.dumps({"version": manifest["version"], "counts": manifest["counts"]}, ensure_ascii=False))
    return 0


def command_compose_manifest(args: argparse.Namespace) -> int:
    vehicle = _read_json(args.vehicle)
    if vehicle is None:
        raise SystemExit("Vehicle manifest is missing or invalid")
    wanted = _read_json(args.wanted) if args.wanted else None
    if wanted is None and args.current:
        current = _read_json(args.current)
        current_wanted = current.get("wanted") if current else None
        wanted = current_wanted if isinstance(current_wanted, dict) else None
    if wanted is not None:
        vehicle["wanted"] = wanted
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(vehicle, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build sharded vehicle search assets for GitHub Releases")
    sub = parser.add_subparsers(dest="command", required=True)

    metadata = sub.add_parser("metadata", help="Fetch lightweight CKAN metadata")
    metadata.add_argument("--dataset-id", default=DATASET_ID)
    metadata.add_argument("--from-year", type=int, default=2013)
    metadata.add_argument("--to-year", type=int)
    metadata.add_argument("--output", type=Path, required=True)
    metadata.set_defaults(func=command_metadata)

    wanted_metadata = sub.add_parser("wanted-metadata", help="Fetch wanted-vehicle CKAN metadata")
    wanted_metadata.add_argument("--dataset-id", default=WANTED_DATASET_ID)
    wanted_metadata.add_argument("--output", type=Path, required=True)
    wanted_metadata.set_defaults(func=command_wanted_metadata)

    changed = sub.add_parser("changed", help="Compare source metadata with the current manifest")
    changed.add_argument("--metadata", type=Path, required=True)
    changed.add_argument("--manifest", type=Path, required=True)
    changed.add_argument("--github-output", type=Path)
    changed.set_defaults(func=command_changed)

    wanted_changed = sub.add_parser("wanted-changed", help="Compare wanted source with current manifest")
    wanted_changed.add_argument("--metadata", type=Path, required=True)
    wanted_changed.add_argument("--manifest", type=Path, required=True)
    wanted_changed.add_argument("--github-output", type=Path)
    wanted_changed.set_defaults(func=command_wanted_changed)

    build = sub.add_parser("build", help="Download resources and build release assets")
    build.add_argument("--metadata", type=Path)
    build.add_argument("--input", type=Path, action="append", default=[])
    build.add_argument("--dataset-id", default=DATASET_ID)
    build.add_argument("--from-year", type=int, default=2013)
    build.add_argument("--to-year", type=int)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--repository", default=os.getenv("GITHUB_REPOSITORY", "owner/repository"))
    build.add_argument("--prefix-length", type=int, default=DEFAULT_PREFIX_LENGTH)
    build.add_argument("--max-events", type=int, default=DEFAULT_MAX_EVENTS)
    build.set_defaults(func=command_build)

    wanted_build = sub.add_parser("build-wanted", help="Build the wanted-vehicle search index")
    wanted_build.add_argument("--metadata", type=Path)
    wanted_build.add_argument("--dataset-id", default=WANTED_DATASET_ID)
    wanted_build.add_argument("--output", type=Path, required=True)
    wanted_build.add_argument("--repository", default=os.getenv("GITHUB_REPOSITORY", "owner/repository"))
    wanted_build.add_argument("--prefix-length", type=int, default=DEFAULT_PREFIX_LENGTH)
    wanted_build.set_defaults(func=command_build_wanted)

    compose = sub.add_parser("compose-manifest", help="Attach wanted metadata to a vehicle manifest")
    compose.add_argument("--vehicle", type=Path, required=True)
    compose.add_argument("--current", type=Path)
    compose.add_argument("--wanted", type=Path)
    compose.add_argument("--output", type=Path, required=True)
    compose.set_defaults(func=command_compose_manifest)
    return parser


def main() -> int:
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    args = make_parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
