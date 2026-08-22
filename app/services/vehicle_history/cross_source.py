from collections import defaultdict

from app.schemas.vehicle import VehicleReport
from app.services.auction_history.schemas import AuctionEventView
from app.services.marketplace_history.schemas import MarketplaceListingView
from app.services.vehicle_history.normalization import BrandNormalizer, ModelNormalizer
from app.services.vehicle_history.schemas import CrossSourceWarning


class CrossSourceAnalyzer:
    def analyze(
        self,
        report: VehicleReport,
        auctions: list[AuctionEventView],
        listings: list[MarketplaceListingView],
    ) -> list[CrossSourceWarning]:
        values: dict[str, dict[str, str]] = defaultdict(dict)
        vehicle = report.vehicle
        for field, value in (
            ("brand", vehicle.brand),
            ("model", vehicle.model),
            ("year", vehicle.year),
            ("color", vehicle.color),
            ("engine_capacity", vehicle.engine_capacity),
        ):
            if value is not None:
                values[field]["МВД"] = str(value)
        for event in auctions:
            label = event.auction_name or event.provider
            for field in ("brand", "model", "year", "color", "engine_capacity"):
                value = getattr(event, field)
                if value is not None:
                    values[field][label] = str(value)
        for listing in listings:
            for field in ("brand", "model", "year"):
                value = getattr(listing, field)
                if value is not None:
                    values[field][listing.provider] = str(value)
        warnings = []
        for field, source_values in values.items():
            normalizer = (
                ModelNormalizer.normalize if field == "model" else BrandNormalizer.normalize
            )
            normalized = {
                normalizer(value) if field in {"brand", "model", "color"} else value
                for value in source_values.values()
            }
            if len(normalized) > 1:
                names = {
                    "year": "год",
                    "color": "цвет",
                    "model": "модель",
                    "brand": "марка",
                    "engine_capacity": "объём двигателя",
                }
                warnings.append(
                    CrossSourceWarning(
                        field=field,
                        message=f"В разных источниках указан разный {names[field]} автомобиля.",
                        sources=source_values,
                    )
                )
        return warnings
