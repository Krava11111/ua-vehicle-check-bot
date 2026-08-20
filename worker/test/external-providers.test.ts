import assert from "node:assert/strict";
import test from "node:test";

import { refreshExternalProviders } from "../src/external-providers.js";
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
