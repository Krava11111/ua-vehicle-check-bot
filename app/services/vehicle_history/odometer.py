from app.services.vehicle_history.schemas import MileagePoint, OdometerWarning, WarningSeverity


class OdometerAnalyzer:
    def __init__(self, tolerance_km: int = 1000) -> None:
        self.tolerance_km = max(0, tolerance_km)

    def analyze(self, points: list[MileagePoint]) -> list[OdometerWarning]:
        ordered = sorted(points, key=lambda point: point.date)
        warnings: list[OdometerWarning] = []
        highest = None
        for point in ordered:
            if (
                highest
                and highest.normalized_mileage_km - point.normalized_mileage_km > self.tolerance_km
            ):
                difference = highest.normalized_mileage_km - point.normalized_mileage_km
                severity = (
                    WarningSeverity.HIGH
                    if difference >= 20000
                    else WarningSeverity.MEDIUM
                    if difference >= 5000
                    else WarningSeverity.LOW
                )
                warnings.append(
                    OdometerWarning(
                        severity=severity,
                        previous=highest,
                        current=point,
                        difference_km=difference,
                    )
                )
            if highest is None or point.normalized_mileage_km > highest.normalized_mileage_km:
                highest = point
        return warnings
