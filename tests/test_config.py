from sqlalchemy.engine import make_url

from app.config import Settings


def test_admin_ids_accept_single_integer_from_environment(monkeypatch: object) -> None:
    monkeypatch.setenv("ADMIN_IDS", "878986063")  # type: ignore[attr-defined]
    assert Settings(_env_file=None).admin_ids == (878986063,)


def test_admin_ids_accept_csv_and_json_list() -> None:
    assert Settings(admin_ids="1,2").admin_ids == (1, 2)
    assert Settings(admin_ids=[1, 2]).admin_ids == (1, 2)


def test_database_password_is_safely_encoded() -> None:
    settings = Settings(postgres_password="p@ss:/?#[]+")
    assert make_url(settings.database_url).password == "p@ss:/?#[]+"


def test_fly_postgres_url_uses_async_driver() -> None:
    settings = Settings(DATABASE_URL="postgres://user:secret@host.internal:5432/app")
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert make_url(settings.database_url).password == "secret"
