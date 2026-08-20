from datetime import UTC, datetime

from app.services.insurance.base import InsuranceProvider
from app.services.insurance.schemas import InsuranceResult, InsuranceStatus


class DisabledInsuranceProvider(InsuranceProvider):
    name = "disabled"

    async def check_plate(self, normalized_plate: str) -> InsuranceResult:
        return InsuranceResult(
            status=InsuranceStatus.UNAVAILABLE,
            query=normalized_plate,
            query_type="plate",
            checked_at=datetime.now(UTC),
            source="не подключён",
            message="Легальный официальный API не настроен.",
        )
