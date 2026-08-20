from datetime import UTC, datetime

from app.services.insurance.base import InsuranceProvider
from app.services.insurance.schemas import InsuranceResult, InsuranceStatus


class MockInsuranceProvider(InsuranceProvider):
    """Deterministic development provider. Its data is always clearly labelled as mock."""

    name = "mock"
    supports_vin = True

    async def check_plate(self, normalized_plate: str) -> InsuranceResult:
        return self._result(normalized_plate, "plate")

    async def check_vin(self, normalized_vin: str) -> InsuranceResult:
        return self._result(normalized_vin, "vin")

    def _result(self, query: str, query_type: str) -> InsuranceResult:
        return InsuranceResult(
            status=InsuranceStatus.NOT_FOUND,
            query=query,
            query_type=query_type,
            checked_at=datetime.now(UTC),
            source="MockInsuranceProvider (тестовые данные)",
            message="Тестовый провайдер не подтверждает наличие или отсутствие реального полиса.",
        )
