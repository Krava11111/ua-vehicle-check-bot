import assert from "node:assert/strict";
import test from "node:test";

import { clearReportCacheForTests, getReport, putReport } from "../src/report-state.js";
import type { VehicleReportData } from "../src/types.js";

test("reuses an aggregated report for navigation without another lookup", async () => {
  clearReportCacheForTests();
  const value = {
    schemaVersion: 1,
    reference: "AA1234BB.abcdef123456",
    collectedAt: "2026-08-20T00:00:00Z",
  } as VehicleReportData;
  await putReport(value);
  assert.deepEqual(await getReport(value.reference), value);
});
