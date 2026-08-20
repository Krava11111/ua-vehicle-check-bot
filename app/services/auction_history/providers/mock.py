from app.services.auction_history.base import AuctionProvider
from app.services.auction_history.schemas import AuctionEventData, AuctionSearchResult


class MockAuctionProvider(AuctionProvider):
    name = "Mock Auction"

    def __init__(self, events: list[AuctionEventData] | None = None) -> None:
        self.events = events or []
        self.calls = 0

    async def search_by_vin(self, vin: str) -> AuctionSearchResult:
        self.calls += 1
        return AuctionSearchResult(
            provider=self.name,
            events=[item for item in self.events if item.vin.upper() == vin.upper()],
        )

    async def get_lot(self, lot_id: str) -> AuctionEventData | None:
        return next((item for item in self.events if item.external_id == lot_id), None)

    async def get_photos(self, lot_id: str) -> list[str]:
        item = await self.get_lot(lot_id)
        return list(item.photo_urls) if item else []
