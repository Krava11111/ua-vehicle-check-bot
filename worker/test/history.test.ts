import assert from "node:assert/strict";
import test from "node:test";

import { renderExternalHistory } from "../src/history-format.js";
import { analyzeCrossSource, analyzeOdometer, normalizeMileageKm } from "../src/history.js";
import type { ExternalVehicleHistory, MileagePoint, VehicleMatch } from "../src/types.js";

const match: VehicleMatch = {
  key: "WVWZZZ3CZHE123456",
  matchedBy: "VIN",
  candidates: 1,
  vehicle: {
    v: "WVWZZZ3CZHE123456",
    p: "AA1234BB",
    b: "BMW",
    m: "330I",
    y: 2019,
    c: "BLACK",
    k: "Легковий",
    bt: null,
    pu: null,
    f: null,
    ec: 1998,
    ow: null,
    tw: null,
    e: [["2022-01-01", "10", "ПЕРВИННА РЕЄСТРАЦІЯ", "AA1234BB", "Київ", null]],
  },
};

test("normalizes miles and detects rollback above tolerance", () => {
  assert.equal(normalizeMileageKm(61_340, "mi"), 98_717);
  const points: MileagePoint[] = [
    { date: "2025-01-01T00:00:00Z", mileage: 137_000, unit: "km", normalizedMileageKm: 137_000, source: "AUTO.RIA", sourceReference: null, sourceUrl: null, confidence: "HIGH" },
    { date: "2025-02-01T00:00:00Z", mileage: 136_500, unit: "km", normalizedMileageKm: 136_500, source: "AUTO.RIA", sourceReference: null, sourceUrl: null, confidence: "HIGH" },
    { date: "2026-01-01T00:00:00Z", mileage: 91_000, unit: "km", normalizedMileageKm: 91_000, source: "AUTO.RIA", sourceReference: null, sourceUrl: null, confidence: "HIGH" },
  ];
  const warnings = analyzeOdometer(points, 1_000);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.severity, "HIGH");
});

test("normalizes cosmetic model differences but warns about different year", () => {
  const warnings = analyzeCrossSource(match, [{
    provider: "legal-api", externalId: "lot-1", vin: match.vehicle.v ?? "",
    auctionName: "Copart", lotNumber: "1", auctionDate: "2021-01-01T00:00:00Z",
    location: null, saleStatus: null, finalBid: null, currency: null,
    estimatedRetailValue: null, repairCost: null, primaryDamage: "Front End",
    secondaryDamage: null, odometer: null, odometerUnit: null,
    normalizedOdometerKm: null, odometerStatus: null, titleType: null,
    keysAvailable: null, runAndDrive: null, engineStarts: null, sourceUrl: null,
    brand: "Bmw", normalizedBrand: "BMW", model: "330 i", normalizedModel: "330I",
    year: 2019, color: "BLACK", engineCapacity: 1998, photos: [],
  }], [{
    provider: "AUTO.RIA", externalId: "ria-1", vin: match.vehicle.v ?? "",
    url: null, title: null, brand: "BMW", normalizedBrand: "BMW", model: "330I",
    normalizedModel: "330I", year: 2017, city: null, region: null,
    firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z",
    removedAt: null, isActive: true, snapshots: [],
  }]);
  assert.deepEqual(warnings.map((item) => item.field), ["year"]);
});

test("renders safe absence wording for empty connected history", () => {
  const history: ExternalVehicleHistory = {
    vin: match.vehicle.v ?? "",
    marketplace: [],
    auctions: [],
    mileage: [],
    odometerWarnings: [],
    crossSourceWarnings: [],
    timeline: [],
    repeatedSalePeriods: 0,
    historyScore: 100,
    scoreFactors: [],
    storageAvailable: true,
  };
  const rendered = renderExternalHistory(history, match, "ru").join("\n");
  assert.match(rendered, /В подключённых легальных источниках .* не найдено/);
  assert.match(rendered, /Это не означает, что автомобиль никогда не продавался/);
  assert.match(rendered, /не является технической диагностикой/);
});
