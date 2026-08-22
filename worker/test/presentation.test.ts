import assert from "node:assert/strict";
import test from "node:test";

import { RegionResolver, RegistrationOperationFormatter } from "../src/presentation.js";
import type { CompactEvent } from "../src/types.js";

test("resolves KOATUU codes without leaking unknown numeric codes", () => {
  assert.equal(RegionResolver.resolve("8038900000", "ru"), "Киев");
  assert.equal(RegionResolver.resolve("8038900000", "uk"), "Київ");
  assert.equal(RegionResolver.resolve("9999999999", "ru"), null);
  assert.equal(RegionResolver.resolve("Київська область", "uk"), "Київська область");
});

test("formats raw registration operations for the selected language", () => {
  const owner: CompactEvent = ["2016-03-31", "309", "ПЕРЕРЕЄСТРАЦІЯ ТЗ НА НОВОГО ВЛАСНИКА", null, null, null];
  const plate: CompactEvent = ["2016-04-19", "410", "ПЕРЕРЕЄСТРАЦІЯ ПРИ ЗАМІНІ НОМЕРНОГО ЗНАКУ", null, null, null];
  assert.equal(RegistrationOperationFormatter.format(owner, "ru").label, "Перерегистрация на нового владельца");
  assert.equal(RegistrationOperationFormatter.format(owner, "ru").ownerChange, true);
  assert.equal(RegistrationOperationFormatter.format(plate, "uk").label, "Заміна номерного знака");
  assert.equal(RegistrationOperationFormatter.format(plate, "uk").ownerChange, false);
});
