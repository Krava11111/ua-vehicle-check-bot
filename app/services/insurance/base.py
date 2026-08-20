from __future__ import annotations

from abc import ABC, abstractmethod

from app.services.insurance.schemas import InsuranceResult


class InsuranceProvider(ABC):
    name: str
    supports_vin: bool = False

    @abstractmethod
    async def check_plate(self, normalized_plate: str) -> InsuranceResult:
        raise NotImplementedError

    async def check_vin(self, normalized_vin: str) -> InsuranceResult:
        raise NotImplementedError("Provider does not support VIN checks")
