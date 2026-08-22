from app.services.auction_history.base import AuctionProvider
from app.services.auction_history.schemas import AuctionSearchResult


class DisabledAuctionProvider(AuctionProvider):
    name = "Auction provider disabled"

    async def search_by_vin(self, vin: str) -> AuctionSearchResult:
        return AuctionSearchResult(
            provider=self.name, unavailable_reason="Provider is not configured"
        )
