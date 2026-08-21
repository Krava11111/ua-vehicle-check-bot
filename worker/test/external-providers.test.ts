import assert from "node:assert/strict";
import test from "node:test";

import { fetchAuctions, refreshExternalProviders } from "../src/external-providers.js";
import type { Env } from "../src/types.js";

test("external providers remain honest when API keys are absent", async () => {
  const env = {} as Env;
  const result = await refreshExternalProviders("WVWZZZ3CZHE123456", env);
  assert.equal(result.autoRia, "not_configured");
  assert.equal(result.auctions, "not_configured");
});

test("external providers reject malformed VIN before network access", async () => {
  let message = "";
  try {
    await refreshExternalProviders("INVALID", {} as Env);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /invalid_vin/);
});

test("auction lookup uses exact VIN endpoints and inherits VIN for sale history", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname.endsWith("/history")) {
      return Response.json({ response: { data: {
        vehicle: {
          vin: "5UXTR9C55JLC73127",
          platform: "copart",
          lot_number: "44692704",
        },
        history: [{
          platform: "copart",
          date: "2024-03-26",
          price: 14_600,
          status: "Sold",
        }],
      } } });
    }
    return Response.json({ data: {
      vin: "5UXTR9C55JLC73127", slug_vin: "2018-bmw-x3-5UXTR9C55JLC73127",
      platform: "copart", lot_number: "44692704", year: 2018, make: "BMW", model: "X3",
      auction: { state: "finished", full_date: "2024-03-26T14:00:00Z" },
      pricing: { last_sold_price_usd: 14_500 },
      location: { display: "Tampa South (FL)" },
      condition: { primary_damage: "Front end", has_key: true, run_condition: { value: "ENGINE START PROGRAM" } },
      odometer: { mi: 35_459, km: 57_066 },
      vehicle_specs: { exterior_color: "White", engine: { size_l: "2.0" } },
      sale_document: { name: "CERTIFICATE OF DESTRUCTION" },
      media: { items: [{
        thumb: "https://example.com/thumb.jpg",
        full: "https://example.com/full.jpg",
      }] },
    } });
  }) as typeof fetch;
  try {
    const records = await fetchAuctions("5UXTR9C55JLC73127", {
      AUCTION_API_KEY: "test-key",
      AUCTION_API_BASE_URL: "https://apibara.tech/api/v1/vehicle-auction",
    } as Env);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.vin, "5UXTR9C55JLC73127");
    assert.equal(records[0]?.auctionName, "copart");
    assert.equal(records[0]?.lotNumber, "44692704");
    assert.equal(records[0]?.finalBid, 14_600);
    assert.equal(records[0]?.saleStatus, "Sold");
    assert.equal(records[0]?.auctionDate, "2024-03-26T00:00:00.000Z");
    assert.equal(records[0]?.odometerUnit, "mi");
    assert.equal(records[0]?.location, "Tampa South (FL)");
    assert.equal(records[0]?.engineStarts, true);
    assert.equal(records[0]?.engineCapacity, 2);
    assert.equal(records[0]?.photoUrls?.length, 1);
    assert.equal(records[0]?.photoUrls?.[0], "https://example.com/full.jpg");
    assert.equal(requested.some((url) => url.endsWith("/vehicles/5UXTR9C55JLC73127")), true);
    assert.equal(requested.some((url) => url.endsWith("/vehicles/5UXTR9C55JLC73127/history?per_page=20")), true);
    assert.equal(requested.some((url) => url.includes("/vehicles?s=")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auction lookup falls back to ended lots when exact VIN endpoints miss", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (!url.searchParams.has("s")) return new Response(null, { status: 404 });
    return Response.json({ data: [{
      vin: "5UXTR9C55JLC73127",
      platform: "copart",
      lot_number: "44692704",
      date: "2024-03-26",
      price: 14_600,
      status: "Sold",
    }] });
  }) as typeof fetch;
  try {
    const records = await fetchAuctions("5UXTR9C55JLC73127", {
      AUCTION_API_KEY: "test-key",
      AUCTION_API_BASE_URL: "https://apibara.tech/api/v1/vehicle-auction",
    } as Env);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.lotNumber, "44692704");
    assert.equal(records[0]?.finalBid, 14_600);
    const archiveUrl = new URL(requested.at(-1) ?? "https://example.invalid");
    assert.equal(archiveUrl.searchParams.get("s"), "5UXTR9C55JLC73127");
    assert.equal(archiveUrl.searchParams.get("lot_status"), "All");
    assert.equal(archiveUrl.searchParams.get("lot_sub_status"), "Ended");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
