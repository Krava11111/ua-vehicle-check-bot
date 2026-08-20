import assert from "node:assert/strict";
import test from "node:test";

import { insuranceKeyboard, mainKeyboard } from "../src/telegram.js";

test("main keyboard includes insurance search", () => {
  assert.match(JSON.stringify(mainKeyboard("uk")), /Перевірити страховку/);
  assert.match(JSON.stringify(mainKeyboard("ru")), /Проверить страховку/);
});

test("insurance button opens the official MTSBU service", () => {
  assert.match(JSON.stringify(insuranceKeyboard("uk")), /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
});
