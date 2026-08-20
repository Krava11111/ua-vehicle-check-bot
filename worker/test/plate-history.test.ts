import assert from "node:assert/strict";
import test from "node:test";

import { renderPlateHistory } from "../src/plate-history.js";
import type { PlateHistoryResult } from "../src/types.js";

test("renders multiple plate assignments with coverage and identity warnings", () => {
  const result: PlateHistoryResult = {
    plate: "AA1234BB",
    assignments: [
      ["vin-1", "WVWZZZ3CZHE123456", "Volkswagen", "Passat", 2017, "Чорний", "Легковий", "2021-05-01", "2024-01-10", 3, "HIGH"],
      ["anon-2", null, "Skoda", "Octavia", 2019, "Сірий", "Легковий", "2024-01-12", "2024-01-12", 1, "LOW"],
    ],
    totalAssignments: 2,
    truncated: false,
    source: "plate-history",
  };

  const rendered = renderPlateHistory(result, "ru", 2013, "МВД", "https://example.com").join("\n");

  assert.match(rendered, /найдено автомобилей: 2/);
  assert.match(rendered, /01\.05\.2021 → 10\.01\.2024/);
  assert.match(rendered, /Первое известное появление номера: 12\.01\.2024/);
  assert.match(rendered, /Номер не является постоянным уникальным идентификатором/);
  assert.match(rendered, /Некоторые записи без VIN невозможно однозначно связать/);
  assert.match(rendered, /короткого известного периода/);
  assert.match(rendered, /примерно с 2013 года/);
});

test("marks fallback history as incomplete", () => {
  const result: PlateHistoryResult = {
    plate: "KA3333CC",
    assignments: [["vin-1", "WVWZZZ3CZHE123456", null, null, null, null, null, null, null, 1, "LOW"]],
    totalAssignments: 1,
    truncated: false,
    source: "vehicle-fallback",
  };
  const rendered = renderPlateHistory(result, "uk", 2013, "МВС", "https://example.com").join("\n");
  assert.match(rendered, /сумісний режим старого індексу/);
  assert.match(rendered, /Перша відома поява номера: —/);
});
