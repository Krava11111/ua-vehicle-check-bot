import assert from "node:assert/strict";
import test from "node:test";

import { insuranceKeyboard, mainKeyboard, vehicleReportKeyboard } from "../src/telegram.js";

test("main keyboard includes insurance search", () => {
  assert.match(JSON.stringify(mainKeyboard("uk")), /Перевірити страховку/);
  assert.match(JSON.stringify(mainKeyboard("ru")), /Проверить страховку/);
});

test("insurance button opens the official MTSBU service", () => {
  assert.match(JSON.stringify(insuranceKeyboard("uk")), /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
});

test("vehicle report lets the user copy plate and VIN before opening MTSBU", () => {
  const keyboard = JSON.stringify(vehicleReportKeyboard("ru", "AA1234BB", "WVWZZZ3CZHE123456"));
  assert.match(keyboard, /Скопировать номер AA1234BB/);
  assert.match(keyboard, /"copy_text":\{"text":"AA1234BB"\}/);
  assert.match(keyboard, /"copy_text":\{"text":"WVWZZZ3CZHE123456"\}/);
  assert.match(keyboard, /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
});

test("vehicle report omits copy buttons for unavailable identifiers", () => {
  const keyboard = JSON.stringify(vehicleReportKeyboard("uk", null, null));
  assert.equal(keyboard.includes("copy_text"), false);
  assert.match(keyboard, /Перевірити страховку в МТСБУ/);
});
