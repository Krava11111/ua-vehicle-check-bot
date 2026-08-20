from decimal import Decimal
from uuid import uuid4

from app.services.payments.base import PaymentIntent, PaymentProvider


class MockPaymentProvider(PaymentProvider):
    async def create_payment(
        self, user_id: int, amount: Decimal, currency: str, feature: str
    ) -> PaymentIntent:
        external_id = f"mock-{user_id}-{feature}-{uuid4().hex}"
        return PaymentIntent(
            external_id, f"https://example.invalid/pay/{external_id}", amount, currency
        )

    async def verify(self, external_id: str) -> bool:
        return external_id.startswith("mock-")
