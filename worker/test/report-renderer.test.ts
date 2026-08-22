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
    externalHistory: {
      auctions: "not_connected",
      marketplace: "not_connected",
      odometer: "not_connected",
      data: null,
      bidfaxUrl: "https://bidfax.co/",
    },
    source: {
      label: "МВС / відкриті дані", url: "https://data.gov.ua/mvs", updatedAt: "2026-08-19",
      coverageThrough: "2026-07-31", updateFrequency: "monthly",
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
  assert.match(rendered, /Данные реестра по: 31\.07\.2026 включительно/);
  assert.match(rendered, /База обновляется раз в месяц/);
  assert.match(rendered, /Последнее обновление источника: 19\.08\.2026/);
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
  assert.match(rendered, /Первым указано авто/);
  assert.match(rendered, /AUDI Q7/);
  assert.match(rendered, /2967 см³/);
  assert.match(rendered, /AUDI E-TRON/);
  assert.match(rendered, /ELECTRIC/);
});

test("plate lookup asks whether the historical VIN is still current", () => {
  const value = report("WVWZZZ3CZHE123456");
  const rendered = ReportRenderer.renderVinConfirmation(value.match, "AA1234BB", "ru");
  assert.match(rendered, /исторический VIN/);
  assert.match(rendered, /WVWZZZ3CZHE123456/);
  assert.match(rendered, /сейчас актуально/);
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
  const summary = ReportRenderer.renderFullReportSummary(value, "ru");
  assert.match(summary, /STARCAR · ОТЧЁТ/);
  assert.match(summary, /КОРОТКО ОБ АВТО/);
  assert.match(summary, /Периодов владения: 2/);
  assert.match(summary, /Первое известное событие: 01\.10\.2014/);
  assert.match(summary, /ПРОВЕРКИ/);
  assert.match(summary, /✅ Розыск: совпадений не найдено/);
  assert.match(summary, /⚪ Аукционы США: источник не подключён/);
  assert.match(summary, /Индекс истории Starcar: 100\/100/);
  assert.match(summary, /Выберите раздел/);
  assert.match(ReportRenderer.renderVinSection(value, "ru").join("\n"), /WMI/);
  const parts = ReportRenderer.renderAll(value, "ru");
  const all = parts.join("\n");
  assert.equal(all.includes("Выберите раздел"), false);
  assert.equal((all.match(/Розыск/g) ?? []).length, 1);
  assert.equal(all.includes("АУКЦИОНЫ США"), false);
  assert.equal(all.includes("ИСТОРИЯ ОБЪЯВЛЕНИЙ AUTO.RIA"), false);
  assert.equal(all.includes("ИСТОРИЯ ПРОБЕГА"), false);
  assert.equal(parts.length <= 3, true);
  assert.equal(parts.every((part) => part.length <= 3_900), true);
});

test("external sections render connected AUTO.RIA and Copart history", () => {
  const value = report();
  value.externalHistory = {
    auctions: "available",
    marketplace: "available",
    odometer: "available",
    bidfaxUrl: "https://bidfax.co/",
    data: {
      vin: value.match.vehicle.v ?? "",
      storageAvailable: true,
      auctions: [{
        provider: "auction-api", externalId: "copart:123", vin: value.match.vehicle.v ?? "",
        auctionName: "Copart", lotNumber: "123", auctionDate: "2025-05-20T00:00:00Z",
        location: "CA - Los Angeles", saleStatus: "sold", finalBid: 7_500, currency: "USD",
        estimatedRetailValue: null, repairCost: null, primaryDamage: "Front End", secondaryDamage: null,
        odometer: 61_000, odometerUnit: "mi", normalizedOdometerKm: 98_170, odometerStatus: null,
        titleType: "Salvage", keysAvailable: true, runAndDrive: true, engineStarts: true,
        sourceUrl: "https://www.copart.com/lot/123", brand: "AUDI", normalizedBrand: "AUDI",
        model: "Q7", normalizedModel: "Q7", year: 2015, color: "BROWN", engineCapacity: 2967,
        photos: ["https://example.com/photo.jpg"],
      }],
      marketplace: [{
        provider: "AUTO.RIA", externalId: "ria-42", vin: value.match.vehicle.v ?? "",
        url: "https://auto.ria.com/uk/auto_42.html", title: "Audi Q7", brand: "AUDI",
        normalizedBrand: "AUDI", model: "Q7", normalizedModel: "Q7", year: 2015,
        city: "Київ", region: "Київська", firstSeenAt: "2026-08-01T00:00:00Z",
        lastSeenAt: "2026-08-20T00:00:00Z", removedAt: null, isActive: true,
        snapshots: [{ observedAt: "2026-08-20T00:00:00Z", price: 19_500, currency: "USD", mileage: 170_000, mileageUnit: "km", normalizedMileageKm: 170_000, descriptionHash: null, isActive: true }],
      }],
      mileage: [{ date: "2025-05-20T00:00:00Z", mileage: 61_000, unit: "mi", normalizedMileageKm: 98_170, source: "Copart", sourceReference: "123", sourceUrl: null, confidence: "HIGH" }],
      odometerWarnings: [], crossSourceWarnings: [], timeline: [], repeatedSalePeriods: 1,
      historyScore: 90, scoreFactors: ["аукціонна подія"],
    },
  };
  const auctionCaption = ReportRenderer.renderAuctionPhotoCaption(value.externalHistory.data!.auctions[0]!, "ru");
  assert.match(auctionCaption, /Дата продажи/);
  assert.match(auctionCaption, /Основное повреждение: Front End/);
  assert.match(auctionCaption, /Финальная ставка/);
  assert.match(auctionCaption, /98[\s ]170 км/);
  assert.match(ReportRenderer.renderExternalSection(value, "auctions", "ru").join("\n"), /Copart/);
  assert.match(ReportRenderer.renderExternalSection(value, "auctions", "ru").join("\n"), /Front End/);
  assert.match(ReportRenderer.renderExternalSection(value, "marketplace", "ru").join("\n"), /19\s500 USD/);
  assert.match(ReportRenderer.renderExternalSection(value, "odometer", "ru").join("\n"), /61\s000 mi/);
});
