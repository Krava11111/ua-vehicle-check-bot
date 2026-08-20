from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas.vehicle import VehicleReport


class PDFReportGenerator(ABC):
    @abstractmethod
    async def generate(self, report: VehicleReport) -> bytes:
        raise NotImplementedError
