from __future__ import annotations

import gzip
import json
import zipfile
from pathlib import Path

from tools.build_release_index import build_index, local_metadata, shard_for


def test_builds_plate_and_vehicle_shards(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "vehicles.csv"
    output = tmp_path / "index"

    manifest = build_index(
        local_metadata([fixture]),
        output,
        repository="example/vehicle-bot",
        prefix_length=3,
        max_events=50,
    )

    vin = "WVWZZZ3CZHE123456"
    plate = "KA3333CC"
    vehicle_shard = shard_for(vin, 3)
    plate_shard = shard_for(plate, 3)
    archive_path = output / "archives" / f"index-{vehicle_shard[0]}.zip"
    with zipfile.ZipFile(archive_path) as archive:
        vehicles = json.loads(gzip.decompress(archive.read(f"vehicles-{vehicle_shard}.json.gz")))
    plate_archive_path = output / "archives" / f"index-{plate_shard[0]}.zip"
    with zipfile.ZipFile(plate_archive_path) as archive:
        plates = json.loads(gzip.decompress(archive.read(f"plates-{plate_shard}.json.gz")))

    assert vehicles[vin]["p"] == plate
    assert len(vehicles[vin]["e"]) == 2
    assert plates[plate] == [vin]
    assert manifest["counts"]["vehicles"] == 1
    assert manifest["counts"]["plates"] == 2
    assert "{group}" in manifest["archive_url_template"]
    assert manifest["schema_version"] == 2


def test_shards_are_stable() -> None:
    assert shard_for("AA1234BB", 3) == shard_for("AA1234BB", 3)
    assert len(shard_for("AA1234BB", 3)) == 3


def test_detects_csv_with_corrupted_extension(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "vehicles.csv"
    archive_path = tmp_path / "official-2019.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(fixture, arcname="vehicles.сsv")  # Cyrillic 'с', as seen in official data.

    output = tmp_path / "index"
    manifest = build_index(
        local_metadata([archive_path]),
        output,
        repository="example/vehicle-bot",
        prefix_length=3,
        max_events=50,
    )

    assert manifest["counts"]["vehicles"] == 1
    assert manifest["counts"]["valid_rows"] == 2
