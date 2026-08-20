from __future__ import annotations

from abc import ABC, abstractmethod

from app.services.auction_history.schemas import AuctionEventData, AuctionSearchResult


class AuctionProvider(ABC):
    name: str

    @abstractmethod
    async def search_by_vin(self, vin: str) -> AuctionSearchResult:
        raise NotImplementedError

    async def get_lot(self, lot_id: str) -> AuctionEventData | None:
        return None

    async def get_photos(self, lot_id: str) -> list[str]:
        return []
