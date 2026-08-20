from __future__ import annotations

import argparse
import asyncio
import shutil
from datetime import UTC, datetime
from pathlib import Path
from tempfile import mkdtemp

from redis.asyncio import Redis
from sqlalchemy import select

from app.cache import Cache
from app.config import get_settings
from app.database.models import Dataset, DatasetStatus
from app.database.session import create_engine_and_session
from app.logging import configure_logging
from data_importer.files import discover_csv, download_file, inspect_csv, sha256_file
from data_importer.importer import DatasetRequiresReviewError, VehicleImporter
from data_importer.parser import parse_batches, validate_sample


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import official vehicle CSV/ZIP dataset")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--file", type=Path)
    source.add_argument("--url")
    parser.add_argument("--source-name", default="МВС України / data.gov.ua")
    parser.add_argument("--name", default="Відомості про транспортні засоби")
    parser.add_argument("--batch-size", type=int, default=25_000)
    return parser.parse_args()


async def run(args: argparse.Namespace) -> None:
    settings = get_settings()
    temp_download: Path | None = None
    unpacked: Path | None = None
    source_url = args.url or settings.dataset_default_url
    if args.file:
        source_path = args.file.resolve()
    elif source_url:
        temp_download = Path(mkdtemp(prefix="autocheck-download-"))
        source_path = await download_file(source_url, temp_download)
    else:
        raise SystemExit("Укажите --file, --url или DATASET_DEFAULT_URL")
    if not source_path.is_file():
        raise SystemExit(f"Файл не найден: {source_path}")

    checksum = sha256_file(source_path)
    engine, session_factory = create_engine_and_session(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    cache = Cache(redis)
    try:
        existing_id: int | None = None
        async with session_factory() as session:
            existing = await session.scalar(select(Dataset).where(Dataset.checksum == checksum))
            if existing and existing.status == DatasetStatus.COMPLETED:
                print("Этот файл уже успешно импортирован; повторный импорт не требуется.")
                return
            existing_id = existing.id if existing else None
        csv_files, unpacked = discover_csv(source_path)
        inspections = [(path, *inspect_csv(path)) for path in csv_files]
        validations = [
            validate_sample(path, encoding, delimiter, headers)
            for path, encoding, delimiter, headers in inspections
        ]
        signatures = [
            {"headers": headers, "delimiter": delimiter, "validation": validation}
            for (_, _, delimiter, headers), validation in zip(inspections, validations, strict=True)
        ]
        async with session_factory() as session:
            previous = await session.scalar(
                select(Dataset)
                .where(Dataset.status == DatasetStatus.COMPLETED)
                .order_by(Dataset.id.desc())
                .limit(1)
            )
            dataset = await session.get(Dataset, existing_id) if existing_id else None
            if dataset is None:
                dataset = Dataset(
                    name=args.name,
                    source_url=source_url,
                    source_name=args.source_name,
                    downloaded_at=datetime.now(UTC) if source_url else None,
                    checksum=checksum,
                )
            dataset.schema_signature = {"files": signatures}
            dataset.error_message = None
            if previous and previous.schema_signature:
                old_headers = set(previous.schema_signature["files"][0]["headers"])
                new_headers = set(signatures[0]["headers"])
                overlap = len(old_headers & new_headers) / max(1, len(old_headers | new_headers))
                if overlap < 0.6:
                    dataset.status = DatasetStatus.REQUIRES_REVIEW
                    dataset.error_message = (
                        f"Схема значительно изменилась (совпадение {overlap:.0%})"
                    )
                    session.add(dataset)
                    await session.commit()
                    raise DatasetRequiresReviewError(dataset.error_message)
            session.add(dataset)
            await session.commit()
            await session.refresh(dataset)
        batches = (
            batch
            for path, encoding, delimiter, headers in inspections
            for batch in parse_batches(path, encoding, delimiter, headers, args.batch_size)
        )
        stats = await VehicleImporter(session_factory, cache).import_rows(
            batches, dataset, args.source_name
        )
        print(
            f"Импорт завершён: всего={stats.total}, добавлено={stats.added}, обновлено={stats.updated}, пропущено={stats.skipped}"
        )
    finally:
        await redis.aclose()
        await engine.dispose()
        if unpacked:
            shutil.rmtree(unpacked, ignore_errors=True)
        if temp_download:
            shutil.rmtree(temp_download, ignore_errors=True)


def main() -> None:
    configure_logging()
    asyncio.run(run(arguments()))


if __name__ == "__main__":
    main()
