from __future__ import annotations

from app.services.marketplace_history.base import MarketplaceProvider
from app.services.marketplace_history.schemas import MarketplaceListingData, MarketplaceSearchResult


class AutoRiaProvider(MarketplaceProvider):
    """Safe disabled production adapter until AUTO.RIA documents VIN search.

    The public API documents advertisement search and lookup by advertisement id, but a
    VIN search contract could not be verified. This adapter deliberately performs no HTTP
    request instead of guessing an endpoint or parameter.
    """

    name = "AUTO.RIA"

    async def search_by_vin(self, vin: str) -> MarketplaceSearchResult:
        return MarketplaceSearchResult(
            provider=self.name,
            unavailable_reason="Official AUTO.RIA VIN-search contract is not configured",
        )

    async def get_listing(self, listing_id: str) -> MarketplaceListingData | None:
        return None
