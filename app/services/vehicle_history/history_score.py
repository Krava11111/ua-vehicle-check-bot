from app.config import Settings
from app.services.vehicle_history.schemas import (
    CrossSourceWarning,
    HistoryScore,
    OdometerWarning,
    RepeatedSaleAnalysis,
    WarningSeverity,
)


class HistoryScoreService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def calculate(
        self,
        auction_count: int,
        damage_count: int,
        odometer: list[OdometerWarning],
        mismatches: list[CrossSourceWarning],
        repeated: RepeatedSaleAnalysis,
    ) -> HistoryScore:
        score = 100
        factors = ["🟢 VIN последовательно используется для объединения доступной истории"]
        if auction_count:
            score -= self.settings.history_score_auction_penalty
            factors.append(f"🟡 Найдено аукционных событий: {auction_count}")
        if damage_count:
            score -= self.settings.history_score_damage_penalty
            factors.append("🟠 Источник аукциона указывает повреждения")
        penalties = {
            WarningSeverity.LOW: self.settings.history_score_odometer_low_penalty,
            WarningSeverity.MEDIUM: self.settings.history_score_odometer_medium_penalty,
            WarningSeverity.HIGH: self.settings.history_score_odometer_high_penalty,
        }
        for warning in odometer:
            score -= penalties[warning.severity]
        if odometer:
            factors.append("🔴 Обнаружено возможное несоответствие показаний пробега")
        score -= len(mismatches) * self.settings.history_score_mismatch_penalty
        if mismatches:
            factors.append("🟠 Есть расхождения характеристик между источниками")
        if repeated.repeated:
            score -= self.settings.history_score_repeated_sale_penalty
            factors.append("🟡 Автомобиль повторно появлялся в объявлениях")
        return HistoryScore(value=max(0, min(100, score)), factors=factors)
