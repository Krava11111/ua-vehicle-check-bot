import assert from "node:assert/strict";
import test from "node:test";

import { detectQuery, normalizePlate, normalizeVin } from "../src/normalization.js";

test("normalizes Ukrainian plate characters", () => {
  assert.equal(normalizePlate(" аа-1234-вв "), "AA1234BB");
  assert.deepEqual(detectQuery("AA1234BB"), { kind: "PLATE", normalized: "AA1234BB" });
});

test("validates VIN", () => {
  assert.equal(normalizeVin("WVWZZZ3CZHE123456"), "WVWZZZ3CZHE123456");
  assert.equal(normalizeVin("WVWZZZ3CZIE123456"), null);
});
