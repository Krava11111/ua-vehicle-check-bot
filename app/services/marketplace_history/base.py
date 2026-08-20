from __future__ import annotations

from abc import ABC, abstractmethod

from app.services.marketplace_history.schemas import (
    MarketplaceListingData,
    MarketplaceSearchResult,
)


class MarketplaceProvider(ABC):
    name: str

    @abstractmethod
    async def search_by_vin(self, vin: str) -> MarketplaceSearchResult:
        raise NotImplementedError

    @abstractmethod
    async def get_listing(self, listing_id: str) -> MarketplaceListingData | None:
        raise NotImplementedError

    async def get_listing_photos(self, listing_id: str) -> list[str]:
        return []
