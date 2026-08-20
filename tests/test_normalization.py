import pytest

from app.domain.normalization import QueryKind, detect_query, normalize_plate, normalize_vin


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("AA1234BB", "AA1234BB"),
        ("AA 1234 BB", "AA1234BB"),
        ("АА1234ВВ", "AA1234BB"),
        ("АА 1234 ВВ", "AA1234BB"),
        ("aa-1234-bb", "AA1234BB"),
    ],
)
def test_plate_normalization(raw: str, expected: str) -> None:
    assert normalize_plate(raw) == expected


@pytest.mark.parametrize("raw", ["123", "ZZ1234ZZ", "AA123BB", "AA12345BB"])
def test_invalid_plate(raw: str) -> None:
    assert normalize_plate(raw) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("WVWZZZ3CZHE123456", "WVWZZZ3CZHE123456"),
        ("wvwzzz3czhe123456", "WVWZZZ3CZHE123456"),
        ("WVW ZZZ3C-ZHE 123456", "WVWZZZ3CZHE123456"),
    ],
)
def test_vin_normalization(raw: str, expected: str) -> None:
    assert normalize_vin(raw) == expected


@pytest.mark.parametrize(
    "raw", ["WVWZZZ", "WVWZZZ3CZIE123456", "WVWZZZ3CZOЕ123456", "WVWZZZ3CZQE123456"]
)
def test_invalid_vin(raw: str) -> None:
    assert normalize_vin(raw) is None


def test_detect_query() -> None:
    assert detect_query("АА 1234 ВВ") == (QueryKind.PLATE, "AA1234BB")
    assert detect_query("wvwzzz3czhe123456") == (QueryKind.VIN, "WVWZZZ3CZHE123456")
    assert detect_query("hello") == (QueryKind.UNKNOWN, None)
