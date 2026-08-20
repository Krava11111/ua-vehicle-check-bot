from app.services.marketplace_history.schemas import MarketplaceListingView
from app.services.vehicle_history.schemas import RepeatedSaleAnalysis


class RepeatedSaleAnalyzer:
    @staticmethod
    def analyze(listings: list[MarketplaceListingView]) -> RepeatedSaleAnalysis:
        identities = {(item.provider, item.external_id) for item in listings}
        dates = [item.first_seen_at for item in listings] + [item.last_seen_at for item in listings]
        return RepeatedSaleAnalysis(
            periods_count=len(identities),
            first_seen_at=min(dates) if dates else None,
            last_seen_at=max(dates) if dates else None,
            repeated=len(identities) > 1,
        )
