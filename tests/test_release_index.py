from __future__ import annotations

import gzip
import json
import zipfile
from pathlib import Path

import pytest

from tools.build_release_index import (
    build_index,
    build_wanted_index,
    ensure_manifest_schema_not_downgraded,
    local_metadata,
    shard_for,
)


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
        plate_history = json.loads(
            gzip.decompress(archive.read(f"plate-history-{plate_shard}.json.gz"))
        )

    assert vehicles[vin]["p"] == plate
    assert len(vehicles[vin]["e"]) == 2
    assert plates[plate] == [vin]
    assert plate_history[plate][0][0] == vin
    assert plate_history[plate][0][9] == 1
    assert manifest["counts"]["vehicles"] == 1
    assert manifest["counts"]["plates"] == 2
    assert "{group}" in manifest["archive_url_template"]
    assert manifest["schema_version"] == 6
    assert manifest["history_start_year"] == 2013
    assert manifest["counts"]["plate_assignments"] == 2
    assert vehicles[vin]["e"][0][6] == "Чорний"


def test_shards_are_stable() -> None:
    assert shard_for("AA1234BB", 3) == shard_for("AA1234BB", 3)
    assert len(shard_for("AA1234BB", 3)) == 3


def test_manifest_schema_cannot_be_downgraded() -> None:
    with pytest.raises(ValueError, match="schema 3 over current schema 5"):
        ensure_manifest_schema_not_downgraded(
            {"schema_version": 3}, {"schema_version": 5}
        )

    ensure_manifest_schema_not_downgraded(
        {"schema_version": 5}, {"schema_version": 5}
    )


def test_reused_plate_does_not_merge_different_no_vin_vehicle_clusters(
    tmp_path: Path,
) -> None:
    source = tmp_path / "reused-plate.csv"
    source.write_text(
        "vin,n_reg_new,d_reg,oper_code,oper_name,brand,model,make_year,color,kind,body,fuel,capacity\n"
        ",AA1234BB,01.10.2014,100,РЕЄСТРАЦІЯ,AUDI,Q7,2015,КОРИЧНЕВИЙ,ЛЕГКОВИЙ,УНІВЕРСАЛ,DIESEL,2967\n"
        ",AA1234BB,19.04.2016,410,ЗАМІНА НОМЕРНОГО ЗНАКУ,AUDI,Q7,2015,КОРИЧНЕВИЙ,ЛЕГКОВИЙ,УНІВЕРСАЛ,DIESEL,2967\n"
        "WA1VAAGEXKB009123,AA1234BB,11.03.2021,100,РЕЄСТРАЦІЯ,AUDI,E-TRON,2019,СІРИЙ,ЛЕГКОВИЙ,КРОСОВЕР,ELECTRIC,0\n",
        encoding="utf-8",
    )
    output = tmp_path / "index"
    manifest = build_index(
        local_metadata([source]),
        output,
        repository="example/vehicle-bot",
        prefix_length=3,
        max_events=50,
    )

    plate = "AA1234BB"
    plate_shard = shard_for(plate, 3)
    with zipfile.ZipFile(output / "archives" / f"index-{plate_shard[0]}.zip") as archive:
        plates = json.loads(gzip.decompress(archive.read(f"plates-{plate_shard}.json.gz")))
    keys = plates[plate]
    assert len(keys) == 2

    vehicles = []
    for key in keys:
        vehicle_shard = shard_for(key, 3)
        with zipfile.ZipFile(
            output / "archives" / f"index-{vehicle_shard[0]}.zip"
        ) as archive:
            payload = json.loads(
                gzip.decompress(archive.read(f"vehicles-{vehicle_shard}.json.gz"))
            )
        vehicles.append(payload[key])

    q7 = next(item for item in vehicles if item["m"] == "Q7")
    etron = next(item for item in vehicles if item["m"] == "E-TRON")
    assert len(q7["e"]) == 2
    assert q7["v"] is None
    assert q7["ec"] == 2967
    assert all(event[7] == "DIESEL" for event in q7["e"])
    assert len(etron["e"]) == 1
    assert etron["v"] == "WA1VAAGEXKB009123"
    assert etron["f"] == "ELECTRIC"
    assert manifest["counts"]["vehicles"] == 2


def test_preserves_archive_year_for_undated_plate_assignments(tmp_path: Path) -> None:
    old_source = tmp_path / "vehicles-2025.csv"
    new_source = tmp_path / "vehicles-2026.csv"
    header = "vin,n_reg_new,d_reg,brand,model,make_year\n"
    old_source.write_text(
        header + "WA1VAAGEXKB009123,AA1234BB,,AUDI,E-TRON,2019\n",
        encoding="utf-8",
    )
    new_source.write_text(
        header + "5UXTR9C55JLC73127,AA1234BB,,BMW,X3,2018\n",
        encoding="utf-8",
    )
    metadata = local_metadata([old_source, new_source])
    metadata["resources"][0]["year"] = 2025
    metadata["resources"][1]["year"] = 2026

    output = tmp_path / "index"
    build_index(
        metadata,
        output,
        repository="example/vehicle-bot",
        prefix_length=3,
        max_events=50,
    )

    plate_shard = shard_for("AA1234BB", 3)
    with zipfile.ZipFile(output / "archives" / f"index-{plate_shard[0]}.zip") as archive:
        history = json.loads(
            gzip.decompress(archive.read(f"plate-history-{plate_shard}.json.gz"))
        )["AA1234BB"]
    years_by_key = {assignment[0]: assignment[11] for assignment in history}
    assert years_by_key == {
        "WA1VAAGEXKB009123": 2025,
        "5UXTR9C55JLC73127": 2026,
    }


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


def test_builds_wanted_index_for_plate_and_vin(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "wanted.json"
    output = tmp_path / "wanted-index"
    metadata = {
        "dataset_modified": "2026-08-20T07:16:39Z",
        "source_fingerprint": "a" * 64,
        "source_page": "https://data.gov.ua/dataset/wanted",
        "resource": {
            "name": "CarsWanted.json",
            "url": fixture.resolve().as_uri(),
            "modified": "2026-08-20T07:15:11Z",
        },
    }

    manifest = build_wanted_index(metadata, output, "example/vehicle-bot", prefix_length=3)

    vin = "WVWZZZ3CZHE123456"
    plate = "KA3333CC"
    for identifier in (vin, plate):
        shard = shard_for(identifier, 3)
        archive_path = output / "archives" / f"wanted-index-{shard[0]}.zip"
        with zipfile.ZipFile(archive_path) as archive:
            wanted = json.loads(gzip.decompress(archive.read(f"wanted-{shard}.json.gz")))
        assert wanted[identifier][0][0] == "wanted-1"

    assert manifest["counts"]["indexed_records"] == 2
    assert manifest["counts"]["identifiers"] == 4
    assert "wanted-data-{version}/wanted-index-{group}" in manifest["archive_url_template"]
