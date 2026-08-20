from pathlib import Path

from data_importer.files import inspect_csv
from data_importer.parser import parse_batches, validate_sample

FIXTURE = Path(__file__).parent / "fixtures" / "vehicles.csv"


def test_real_csv_pipeline() -> None:
    encoding, delimiter, headers = inspect_csv(FIXTURE)
    rows = [
        row for batch in parse_batches(FIXTURE, encoding, delimiter, headers, 1) for row in batch
    ]
    assert len(rows) == 2
    assert rows[0].plate == "AA1111AA"
    assert rows[1].vin == "WVWZZZ3CZHE123456"
    assert rows[0].region == "Київська область"
    assert validate_sample(FIXTURE, encoding, delimiter, headers)["valid_identifier_ratio"] == 1


def test_cp1251_streaming(tmp_path: Path) -> None:
    target = tmp_path / "legacy.csv"
    target.write_bytes(FIXTURE.read_text(encoding="utf-8").encode("cp1251"))
    encoding, delimiter, headers = inspect_csv(target)
    rows = next(parse_batches(target, encoding, delimiter, headers))
    assert encoding == "cp1251"
    assert rows[0].color == "Чорний"
