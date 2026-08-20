from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class PaymentIntent:
    external_id: str
    payment_url: str
    amount: Decimal
    currency: str


class PaymentProvider(ABC):
    @abstractmethod
    async def create_payment(
        self, user_id: int, amount: Decimal, currency: str, feature: str
    ) -> PaymentIntent:
        raise NotImplementedError

    @abstractmethod
    async def verify(self, external_id: str) -> bool:
        raise NotImplementedError
