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

test("auction lookup uses documented search and rejects records for another VIN", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname.endsWith("/history")) {
      return Response.json({ data: [{ vin: "5NPEB4AC6DH514668", platform: "iaai", lot_number: "wrong" }] });
    }
    return Response.json({ data: [
      { vin: "5NPEB4AC6DH514668", platform: "iaai", lot_number: "wrong" },
      {
        vin: "WBA4J7C55KBM75906", slug_vin: "2019-bmw-WBA4J7C55KBM75906",
        platform: "copart", lot_number: "54386186", year: 2019, make: "BMW", model: "440XI",
        auction: { state: "open", auction_at: "2026-08-20T13:30:00Z" },
        pricing: { last_sold_price_usd: 7_500 },
        location: { display: "Hartford (CT)" },
        condition: { primary_damage: "Front end", has_key: true, run_condition: { value: "RUNS AND DRIVES" } },
        odometer: { mi: 61_000, km: 98_170 },
        vehicle_specs: { exterior_color: "Black" },
        sale_document: { name: "SALVAGE" },
        media: { thumbs: ["https://example.com/photo.jpg"] },
      },
    ] });
  }) as typeof fetch;
  try {
    const records = await fetchAuctions("WBA4J7C55KBM75906", {
      AUCTION_API_KEY: "test-key",
      AUCTION_API_BASE_URL: "https://apibara.tech/api/v1/vehicle-auction",
    } as Env);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.vin, "WBA4J7C55KBM75906");
    assert.equal(records[0]?.auctionName, "copart");
    assert.equal(records[0]?.odometerUnit, "mi");
    assert.equal(records[0]?.location, "Hartford (CT)");
    assert.equal(records[0]?.runAndDrive, true);
    assert.equal(records[0]?.photoUrls?.length, 1);
    assert.match(requested[0] ?? "", /[?&]s=WBA4J7C55KBM75906/);
    assert.equal(requested.some((url) => url.includes("?vin=")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
