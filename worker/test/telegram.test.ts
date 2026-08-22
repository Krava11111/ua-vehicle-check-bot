import assert from "node:assert/strict";
import test from "node:test";

import {
  actualVinPromptKeyboard,
  auctionPhotoNavigationKeyboard,
  basicReportKeyboard,
  fullReportKeyboard,
  insuranceKeyboard,
  languageSelectionKeyboard,
  mainKeyboard,
  plateHistoryResultKeyboard,
  sectionKeyboard,
  clearUserHistoryKeyboard,
  userReportHistoryKeyboard,
  vinConfirmationKeyboard,
  vehicleReportKeyboard,
} from "../src/telegram.js";
import type { AuctionHistoryEvent } from "../src/types.js";

function auction(): AuctionHistoryEvent {
  return {
    provider: "auction-api", externalId: "copart:123", vin: "WVWZZZ3CZHE123456",
    auctionName: "Copart", lotNumber: "123", auctionDate: "2025-05-20T00:00:00Z",
    location: "CA", saleStatus: "sold", finalBid: 7_500, currency: "USD",
    estimatedRetailValue: null, repairCost: null, primaryDamage: "Front End",
    secondaryDamage: null, odometer: 61_000, odometerUnit: "mi",
    normalizedOdometerKm: 98_170, odometerStatus: null, titleType: "Salvage",
    keysAvailable: true, runAndDrive: true, engineStarts: true,
    sourceUrl: "https://www.copart.com/lot/123", brand: "VOLKSWAGEN",
    normalizedBrand: "VOLKSWAGEN", model: "PASSAT", normalizedModel: "PASSAT",
    year: 2017, color: "BLACK", engineCapacity: 1984,
    photos: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
  };
}

test("main keyboard includes insurance search", () => {
  assert.match(JSON.stringify(mainKeyboard("uk")), /Перевірити страховку/);
  assert.match(JSON.stringify(mainKeyboard("ru")), /Проверить страховку/);
  assert.match(JSON.stringify(mainKeyboard("uk")), /Історія номера/);
  assert.match(JSON.stringify(mainKeyboard("ru")), /История отчётов/);
});

test("full report replaces the generic USA button with auctions", () => {
  const ru = JSON.stringify(fullReportKeyboard("ru", "AA1234BB.abcdef123456"));
  const uk = JSON.stringify(fullReportKeyboard("uk", "AA1234BB.abcdef123456"));
  assert.match(ru, /Аукционы/);
  assert.match(uk, /Аукціони/);
  assert.match(ru, /Показать весь отчёт/);
  assert.match(uk, /Показати весь звіт/);
});

test("first launch offers Ukrainian and Russian language callbacks", () => {
  const keyboard = JSON.stringify(languageSelectionKeyboard());
  assert.match(keyboard, /Українська/);
  assert.match(keyboard, /Русский/);
  assert.match(keyboard, /set_lang:uk/);
  assert.match(keyboard, /set_lang:ru/);
});

test("personal report history buttons only expose opaque row ids", () => {
  const keyboard = JSON.stringify(userReportHistoryKeyboard("ru", [{
    id: 42,
    reportReference: "AA1234BB.abcdef123456",
    vehicleKey: "WVWZZZ3CZHE123456",
    vin: "WVWZZZ3CZHE123456",
    plate: "AA1234BB",
    brand: "VOLKSWAGEN",
    model: "PASSAT",
    year: 2017,
    lastViewedAt: "2026-08-20T12:00:00Z",
    viewCount: 2,
  }]));
  assert.match(keyboard, /history_report:42/);
  assert.match(keyboard, /history_clear_confirm/);
  assert.equal(keyboard.includes("abcdef123456"), false);
  assert.match(JSON.stringify(clearUserHistoryKeyboard("uk")), /history_clear/);
});

test("insurance button opens the official MTSBU service", () => {
  assert.match(JSON.stringify(insuranceKeyboard("uk")), /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
});

test("insurance section keeps an official MTSBU button", () => {
  const keyboard = JSON.stringify(sectionKeyboard("ru", "AA1234BB.abcdef123456", "insurance"));
  assert.match(keyboard, /https:\/\/policy\.mtsbu\.ua\/Search\/Main\//);
  assert.match(keyboard, /full:AA1234BB\.abcdef123456/);
});

test("historical plate VIN requires explicit confirmation", () => {
  const keyboard = JSON.stringify(vinConfirmationKeyboard("ru", "WVWZZZ3CZHE123456", "AA1234BB"));
  assert.match(keyboard, /confirm_vin:WVWZZZ3CZHE123456/);
  assert.match(keyboard, /replace_vin:AA1234BB/);
  assert.match(keyboard, /plate_history:AA1234BB/);
  assert.equal(actualVinPromptKeyboard("uk").force_reply, true);
});

test("auction and basic report buttons expose Copart and BidFax without scraping", () => {
  const section = JSON.stringify(sectionKeyboard("ru", "AA1234BB.abcdef123456", "auctions", "WVWZZZ3CZHE123456", "https://bidfax.co/", [auction()]));
  assert.match(section, /copart\.com\/lotSearchResults/);
  assert.match(section, /bidfax\.co/);
  assert.match(section, /PLC\.ua/);
  assert.match(section, /Все аукционы/);
  assert.match(section, /google\.com\/search/);
  assert.match(section, /plc\.ua%2Fauctions%2Flot/);
  assert.match(section, /WVWZZZ3CZHE123456/);
  assert.match(section, /copy_text/);
  assert.match(section, /auction_photos:0:0:AA1234BB\.abcdef123456/);
  const basic = JSON.stringify(basicReportKeyboard("uk", "AA1234BB.abcdef123456", "AA1234BB", "WVWZZZ3CZHE123456", "https://bidfax.co/"));
  assert.match(basic, /BidFax/);
});

test("auction gallery navigation supports pages and the source lot", () => {
  const keyboard = JSON.stringify(auctionPhotoNavigationKeyboard(
    "ru", "AA1234BB.abcdef123456", 0, 1, 3, "https://www.copart.com/lot/123",
  ));
  assert.match(keyboard, /auction_photos:0:0:AA1234BB\.abcdef123456/);
  assert.match(keyboard, /auction_photos:0:2:AA1234BB\.abcdef123456/);
  assert.match(keyboard, /copart\.com\/lot\/123/);
  assert.match(keyboard, /sec:auctions:AA1234BB\.abcdef123456/);
});

test("latest plate report keeps older vehicle assignments available", () => {
  const keyboard = JSON.stringify(basicReportKeyboard("ru", "AA1234BB.abcdef123456", "AA1234BB", null, null, true));
  assert.match(keyboard, /Другие авто на этом номере/);
  assert.match(keyboard, /candidates:AA1234BB/);
});

test("vehicle report lets the user copy plate and VIN before opening MTSBU", () => {
  const keyboard = JSON.stringify(vehicleReportKeyboard("ru", "AA1234BB", "WVWZZZ3CZHE123456"));
  assert.match(keyboard, /Скопировать номер AA1234BB/);
  assert.match(keyboard, /"copy_text":\{"text":"AA1234BB"\}/);
  assert.match(keyboard, /"copy_text":\{"text":"WVWZZZ3CZHE123456"\}/);
  assert.match(keyboard, /"callback_data":"full:WVWZZZ3CZHE123456"/);
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
