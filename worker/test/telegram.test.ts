import assert from "node:assert/strict";
import test from "node:test";

import {
  insuranceKeyboard,
  mainKeyboard,
  plateHistoryResultKeyboard,
  sectionKeyboard,
  vehicleReportKeyboard,
} from "../src/telegram.js";

test("main keyboard includes insurance search", () => {
  assert.match(JSON.stringify(mainKeyboard("uk")), /Перевірити страховку/);
  assert.match(JSON.stringify(mainKeyboard("ru")), /Проверить страховку/);
  assert.match(JSON.stringify(mainKeyboard("uk")), /Історія номера/);
});

test("insurance button opens the official MTSBU service", () => {
  assert.match(JSON.stringify(insuranceKeyboard("uk")), /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
});

test("insurance section keeps an official MTSBU button", () => {
  const keyboard = JSON.stringify(sectionKeyboard("ru", "AA1234BB.abcdef123456", "insurance"));
  assert.match(keyboard, /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
  assert.match(keyboard, /full:AA1234BB\.abcdef123456/);
});

test("vehicle report lets the user copy plate and VIN before opening MTSBU", () => {
  const keyboard = JSON.stringify(vehicleReportKeyboard("ru", "AA1234BB", "WVWZZZ3CZHE123456"));
  assert.match(keyboard, /Скопировать номер AA1234BB/);
  assert.match(keyboard, /"copy_text":\{"text":"AA1234BB"\}/);
  assert.match(keyboard, /"copy_text":\{"text":"WVWZZZ3CZHE123456"\}/);
  assert.match(keyboard, /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
  assert.match(keyboard, /plate_history:AA1234BB/);
});

test("plate history result links VIN records back to vehicle reports", () => {
  const keyboard = JSON.stringify(
    plateHistoryResultKeyboard("ru", [{ reference: "AA1234BB.abcdef123456" }]),
  );
  assert.match(keyboard, /pick:AA1234BB\.abcdef123456/);
  assert.equal(keyboard.includes("WVWZZZ3CZHE123456"), false);
  assert.equal(keyboard.includes("vehicle_plate:"), false);
});

test("vehicle report omits copy buttons for unavailable identifiers", () => {
  const keyboard = JSON.stringify(vehicleReportKeyboard("uk", null, null));
  assert.equal(keyboard.includes("copy_text"), false);
  assert.match(keyboard, /Перевірити страховку в МТСБУ/);
});
