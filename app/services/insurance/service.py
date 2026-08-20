from app.cache import Cache
from app.config import Settings
from app.domain.normalization import normalize_plate, normalize_vin
from app.services.insurance.base import InsuranceProvider
from app.services.insurance.schemas import InsuranceResult


class InsuranceService:
    def __init__(
        self, provider: InsuranceProvider, cache: Cache | None, settings: Settings
    ) -> None:
        self.provider = provider
        self.cache = cache
        self.settings = settings

    async def check_plate(self, raw_plate: str) -> InsuranceResult:
        value = normalize_plate(raw_plate)
        if not value:
            raise ValueError("invalid_plate")
        return await self._check("plate", value)

    async def check_vin(self, raw_vin: str) -> InsuranceResult:
        value = normalize_vin(raw_vin)
        if not value:
            raise ValueError("invalid_vin")
        if not self.provider.supports_vin:
            raise ValueError("vin_not_supported")
        return await self._check("vin", value)

    async def _check(self, kind: str, value: str) -> InsuranceResult:
        key = f"insurance:{kind}:{value}"
        if self.cache:
            cached = await self.cache.get_json(key)
            if isinstance(cached, dict):
                return InsuranceResult.model_validate(cached)
        result = await (
            self.provider.check_vin(value) if kind == "vin" else self.provider.check_plate(value)
        )
        if self.cache:
            await self.cache.set_json(
                key, result.model_dump(mode="json"), self.settings.insurance_cache_ttl
            )
        return result
