from app.config import Settings
from app.schemas.vehicle import VehicleReport


class DataCoverageService:
    def __init__(self, settings: Settings) -> None:
        self.start_year = settings.vehicle_history_start_year

    def lines(self, report: VehicleReport, language: str = "uk") -> list[str]:
        year = report.vehicle.year
        if language == "ru":
            lines = [
                "ℹ️ <b>Полнота истории</b>",
                f"Доступная регистрационная история сервиса формируется на основании подключённых данных, доступных примерно с {self.start_year} года.",
                "История может быть неполной; отсутствие события не означает отсутствие регистрации или владельца.",
            ]
            if year is not None and year < self.start_year:
                lines.extend(
                    [
                        "\n⚠️ <b>Автомобиль старше периода покрытия базы</b>",
                        f"Автомобиль выпущен в {year} году. Более ранние регистрационные события и владельцы могут отсутствовать.",
                        "Реальное число предыдущих владельцев может быть больше.",
                    ]
                )
            elif year is None:
                lines.append("Год автомобиля неизвестен; история может быть неполной.")
            return lines
        lines = [
            "ℹ️ <b>Повнота історії</b>",
            f"Доступна реєстраційна історія сервісу формується на підставі підключених даних, доступних приблизно з {self.start_year} року.",
            "Історія може бути неповною; відсутність події не означає відсутність реєстрації або власника.",
        ]
        if year is not None and year < self.start_year:
            lines.extend(
                [
                    "\n⚠️ <b>Автомобіль старший за період покриття бази</b>",
                    f"Автомобіль випущений у {year} році. Ранніші реєстраційні події та власники можуть бути відсутні.",
                    "Реальна кількість попередніх власників може бути більшою.",
                ]
            )
        elif year is None:
            lines.append("Рік автомобіля невідомий; історія може бути неповною.")
        return lines
