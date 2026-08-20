import assert from "node:assert/strict";
import test from "node:test";

import { renderVehicleAnalytics } from "../src/analytics.js";
import type { VehicleMatch, WantedCheck } from "../src/types.js";

test("renders evidence-based vehicle analytics without claiming certainty", () => {
  const match: VehicleMatch = {
    key: "WVWZZZ3CZHE123456",
    matchedBy: "VIN",
    candidates: 1,
    vehicle: {
      v: "WVWZZZ3CZHE123456", p: "KA3333CC", b: "Volkswagen", m: "Passat", y: 2017,
      c: "Чорний", k: "Легковий", bt: "Універсал", pu: "Загальний", f: "Diesel",
      ec: 1968, ow: 1500, tw: 2100,
      e: [
        ["2019-04-12", "10", "ПЕРВИННА РЕЄСТРАЦІЯ ТЗ, ВВЕЗЕНОГО З-ЗА КОРДОНУ", "AA1111AA", "Київська область", "ТСЦ 8041", "Сірий", "Diesel", 1968, "Універсал", "Загальний", 1500, 2100, "Легковий"],
        ["2023-06-01", "40", "ПЕРЕРЕЄСТРАЦІЯ НА НОВОГО ВЛАСНИКА", "BA2222BB", "Львівська область", "ТСЦ 4641", "Сірий", "Diesel", 1968, "Універсал", "Загальний", 1500, 2100, "Легковий"],
        ["2023-07-15", "40", "ПЕРЕРЕЄСТРАЦІЯ НА НОВОГО ВЛАСНИКА", "KA3333CC", "Київська область", "ТСЦ 8041", "Чорний", "Diesel", 1968, "Універсал", "Загальний", 1500, 2100, "Легковий"],
      ],
    },
  };
  const wanted: WantedCheck = {
    status: "clear",
    checkedAt: "2026-08-20T07:15:11Z",
    sourceUrl: "https://data.gov.ua/dataset/wanted",
    matches: [],
  };

  const rendered = renderVehicleAnalytics(match, wanted, "uk", new Date("2026-08-20T00:00:00Z"), 2020);

  assert.match(rendered, /Збігів у відкритому реєстрі .* не знайдено/);
  assert.match(rendered, /Виробник за WMI: Volkswagen/);
  assert.match(rendered, /Модельний рік за VIN: 2017/);
  assert.match(rendered, /Перша операція містить ознаку ввезення/);
  assert.match(rendered, /Ймовірних змін власника в доступній історії: 2/);
  assert.match(rendered, /Реальна кількість попередніх власників може бути більшою/);
  assert.match(rendered, /Усього відомих номерів: 3/);
  assert.match(rendered, /Колір: 2019 — Сірий → 2023 — Чорний/);
  assert.match(rendered, /швидкий перепродаж/);
  assert.match(rendered, /не офіційний рейтинг/);
  assert.match(rendered, /ДТП: персональна перевірка .* не виконується/);
  assert.equal(rendered.length <= 3_900, true);
});
