from __future__ import annotations

import csv
import hashlib
import shutil
import zipfile
from pathlib import Path
from tempfile import mkdtemp

import httpx


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


async def download_file(url: str, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = url.rsplit("/", 1)[-1].split("?", 1)[0] or "dataset.bin"
    target = target_dir / filename
    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with target.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    output.write(chunk)
    return target


def discover_csv(source: Path) -> tuple[list[Path], Path | None]:
    if source.suffix.lower() == ".csv":
        return [source], None
    if not zipfile.is_zipfile(source):
        raise ValueError("Поддерживаются только CSV и ZIP с CSV-файлами")
    temp = Path(mkdtemp(prefix="autocheck-import-"))
    with zipfile.ZipFile(source) as archive:
        for member in archive.infolist():
            destination = (temp / member.filename).resolve()
            if temp.resolve() not in destination.parents and destination != temp.resolve():
                raise ValueError("Небезопасный путь в ZIP-архиве")
        archive.extractall(temp)
    csv_files = sorted(
        path for path in temp.rglob("*") if path.is_file() and path.suffix.lower() == ".csv"
    )
    if not csv_files:
        shutil.rmtree(temp)
        raise ValueError("CSV-файлы в архиве не найдены")
    return csv_files, temp


def inspect_csv(path: Path) -> tuple[str, str, list[str]]:
    raw = path.read_bytes()[:131072]
    encoding = "utf-8-sig"
    for candidate in ("utf-8-sig", "cp1251", "utf-16"):
        try:
            sample = raw.decode(candidate)
            encoding = candidate
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("Не удалось определить кодировку CSV")
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.reader(sample.splitlines(), delimiter=delimiter)
    headers = [item.strip().lstrip("\ufeff") for item in next(reader)]
    if len(headers) < 3 or len(set(headers)) != len(headers):
        raise ValueError("Некорректные или дублирующиеся заголовки CSV")
    return encoding, delimiter, headers
