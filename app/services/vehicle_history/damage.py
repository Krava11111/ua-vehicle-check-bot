from app.services.auction_history.schemas import AuctionEventView
from app.services.vehicle_history.schemas import DamageFinding


class DamageAnalyzer:
    """Preserve provider damage labels without inferring accident severity."""

    @staticmethod
    def analyze(events: list[AuctionEventView]) -> list[DamageFinding]:
        return [
            DamageFinding(
                source=event.auction_name or event.provider,
                primary_damage=event.primary_damage,
                secondary_damage=event.secondary_damage,
                title_type=event.title_type,
                sale_status=event.sale_status,
                source_url=event.source_url,
            )
            for event in events
            if event.primary_damage or event.secondary_damage or event.title_type
        ]
