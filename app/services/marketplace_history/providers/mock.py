from __future__ import annotations

from app.services.marketplace_history.base import MarketplaceProvider
from app.services.marketplace_history.schemas import MarketplaceListingData, MarketplaceSearchResult


class MockAutoRiaProvider(MarketplaceProvider):
    name = "AUTO.RIA"

    def __init__(self, listings: list[MarketplaceListingData] | None = None) -> None:
        self.listings = {item.external_id: item for item in listings or []}
        self.calls = 0

    async def search_by_vin(self, vin: str) -> MarketplaceSearchResult:
        self.calls += 1
        matches = [item for item in self.listings.values() if item.vin.upper() == vin.upper()]
        return MarketplaceSearchResult(provider=self.name, listings=matches, authoritative=True)

    async def get_listing(self, listing_id: str) -> MarketplaceListingData | None:
        self.calls += 1
        return self.listings.get(listing_id)

    async def get_listing_photos(self, listing_id: str) -> list[str]:
        item = self.listings.get(listing_id)
        return list(item.photo_urls) if item else []
