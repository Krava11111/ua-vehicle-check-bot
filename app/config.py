from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "production"
    log_level: str = "INFO"
    bot_token: SecretStr = SecretStr("")
    admin_ids: tuple[int, ...] = ()
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "autocheck"
    postgres_user: str = "autocheck"
    postgres_password: SecretStr = SecretStr("change-me")
    database_url_override: str | None = Field(default=None, alias="DATABASE_URL")
    redis_host: str = "redis"
    redis_port: int = 6379
    redis_db: int = 0
    redis_url_override: str | None = Field(default=None, alias="REDIS_URL")
    payments_enabled: bool = False
    free_plate_search: bool = True
    free_vin_search: bool = True
    free_history: bool = True
    free_insurance_search: bool = True
    pdf_reports_enabled: bool = False
    external_paid_data_enabled: bool = False
    insurance_provider: str = "mock"
    vehicle_cache_ttl: int = 86400
    insurance_cache_ttl: int = 3600
    rate_limit_per_minute: int = 10
    daily_search_limit: int = 100
    duplicate_query_limit: int = 5
    suspicious_block_seconds: int = 900
    fast_resale_days: int = 30
    frequent_owner_change_months: int = 24
    frequent_owner_change_count: int = 3
    frequent_plate_change_count: int = 3
    history_coverage_start_year: int = 2013
    query_hash_salt: SecretStr = SecretStr("replace-with-long-random-value")
    dataset_default_url: str | None = None

    @field_validator("admin_ids", mode="before")
    @classmethod
    def parse_admin_ids(cls, value: object) -> object:
        if isinstance(value, int):
            return (value,)
        if isinstance(value, str):
            return tuple(int(item.strip()) for item in value.split(",") if item.strip())
        if isinstance(value, (list, tuple, set)):
            return tuple(int(item) for item in value)
        return value

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            database_url = self.database_url_override
            if database_url.startswith("postgres://"):
                return database_url.replace("postgres://", "postgresql+asyncpg://", 1)
            if database_url.startswith("postgresql://"):
                return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return database_url
        return URL.create(
            drivername="postgresql+asyncpg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        ).render_as_string(hide_password=False)

    @property
    def redis_url(self) -> str:
        return (
            self.redis_url_override
            or f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
