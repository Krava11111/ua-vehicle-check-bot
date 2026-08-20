import assert from "node:assert/strict";
import test from "node:test";

import { ReportRenderer } from "../src/report-renderer.js";
import type { VehicleCandidate, VehicleReportData } from "../src/types.js";

function report(vin: string | null = "WAUZZZ4M0FD123456"): VehicleReportData {
  return {
    schemaVersion: 1,
    reference: "AA1234BB.abcdef123456",
    collectedAt: "2026-08-20T00:00:00Z",
    match: {
      key: vin ?? "F:q7",
      matchedBy: "PLATE",
      candidates: 2,
      vehicle: {
        v: vin, p: "AA1234BB", b: "AUDI", m: "Q7", y: 2015, c: "КОРИЧНЕВИЙ",
        k: "ЛЕГКОВИЙ", bt: "УНІВЕРСАЛ", pu: null, f: "DIESEL", ec: 2967,
        ow: 2100, tw: 2800,
        e: [
          ["2014-10-01", "100", "ПЕРВИННА РЕЄСТРАЦІЯ", "AA1234BB", "8038900000", null, "КОРИЧНЕВИЙ", "DIESEL", 2967, "УНІВЕРСАЛ"],
          ["2016-03-31", "309", "ПЕРЕРЕЄСТРАЦІЯ ТЗ НА НОВОГО ВЛАСНИКА", "AA1234BB", "8038900000", null, "КОРИЧНЕВИЙ", "DIESEL", 2967, "УНІВЕРСАЛ"],
          ["2016-04-19", "410", "ЗАМІНА НОМЕРНОГО ЗНАКУ", "AA1234BB", "8038900000", null, "КОРИЧНЕВИЙ", "DIESEL", 2967, "УНІВЕРСАЛ"],
        ],
      },
    },
    wanted: { status: "clear", checkedAt: "2026-08-20", sourceUrl: "https://data.gov.ua/wanted", matches: [] },
    insurance: { status: "unavailable", source: "MTSBU", checkUrl: "https://policy.mtsbu.ua/Search/Main/" },
    externalHistory: { auctions: "not_connected", marketplace: "not_connected", odometer: "not_connected" },
    source: {
      label: "МВС / відкриті дані", url: "https://data.gov.ua/mvs", updatedAt: "2026-08-19",
      historyStartYear: 2013, maxEventsPerVehicle: 50,
    },
  };
}

test("basic report is one compact card with insurance and wanted but no deep VIN analysis", () => {
  const rendered = ReportRenderer.renderBasicReport(report(), "ru");
  assert.match(rendered, /AUDI Q7/);
  assert.match(rendered, /Известных смен владельца: 1/);
  assert.match(rendered, /ОСАГО/);
  assert.match(rendered, /Совпадений в подключённом открытом реестре не найдено/);
  assert.match(rendered, /Замена номерного знака/);
  assert.equal(rendered.includes("WMI"), false);
  assert.equal(rendered.includes("VIS"), false);
  assert.equal(rendered.includes("8038900000"), false);
  assert.equal(rendered.length <= 3_900, true);
});

test("candidate selector separates Q7 and E-Tron", () => {
  const candidates: VehicleCandidate[] = [
    { candidateId: "aaaaaaaaaaaa", vehicleKey: "F:q7", vin: null, plate: "AA1234BB", brand: "AUDI", model: "Q7", year: 2015, color: "Коричневый", fuel: "DIESEL", engineCapacity: 2967, bodyType: "Универсал", vehicleType: "Легковой", firstSeenAt: "2014-10-01", lastSeenAt: "2016-04-19", registrationsCount: 2, confidence: "MEDIUM" },
    { candidateId: "bbbbbbbbbbbb", vehicleKey: "WA1VAAGEXKB009123", vin: "WA1VAAGEXKB009123", plate: "AA1234BB", brand: "AUDI", model: "E-TRON", year: 2019, color: "Серый", fuel: "ELECTRIC", engineCapacity: null, bodyType: "Кроссовер", vehicleType: "Легковой", firstSeenAt: "2021-03-11", lastSeenAt: "2021-03-11", registrationsCount: 1, confidence: "HIGH" },
  ];
  const rendered = ReportRenderer.renderCandidateSelector("AA1234BB", candidates, "ru");
  assert.match(rendered, /найдено несколько автомобилей/);
  assert.match(rendered, /AUDI Q7/);
  assert.match(rendered, /2967 см³/);
  assert.match(rendered, /AUDI E-TRON/);
  assert.match(rendered, /ELECTRIC/);
});

test("no-VIN characteristic differences are not stated as confirmed changes", () => {
  const value = report(null);
  value.match.vehicle.e[1]![7] = "ELECTRIC";
  value.match.vehicle.e[1]![8] = 0;
  value.match.vehicle.e[1]![9] = "КРОСОВЕР";
  const rendered = ReportRenderer.renderAnalyticsSection(value, "ru").join("\n");
  assert.match(rendered, /невозможно подтвердить, что записи относятся к одному автомобилю/);
  assert.equal(rendered.includes("DIESEL → ELECTRIC"), false);
  assert.equal(rendered.includes("2967 см³ → 0 см³"), false);
});

test("full report is navigable and all-at-once stays within three Telegram messages", () => {
  const value = report();
  assert.match(ReportRenderer.renderFullReportSummary(value, "ru"), /Выберите раздел/);
  assert.match(ReportRenderer.renderVinSection(value, "ru").join("\n"), /WMI/);
  const parts = ReportRenderer.renderAll(value, "ru");
  assert.equal(parts.length <= 3, true);
  assert.equal(parts.every((part) => part.length <= 3_900), true);
});
