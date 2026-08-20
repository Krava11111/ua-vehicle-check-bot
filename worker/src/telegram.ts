import type { FullReportSection, Language, VehicleCandidate } from "./types.js";

export async function telegramCall(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as { ok?: boolean; description?: string };
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? response.status}`);
  }
}

export function mainKeyboard(language: Language): Record<string, unknown> {
  return {
    keyboard: [
      [language === "ru" ? "🚘 Проверить по номеру" : "🚘 Перевірити за номером"],
      [language === "ru" ? "🔢 Проверить по VIN" : "🔢 Перевірити за VIN"],
      [language === "ru" ? "🔖 История номера" : "🔖 Історія номера"],
      [language === "ru" ? "🛡 Проверить страховку" : "🛡 Перевірити страховку"],
      [language === "ru" ? "ℹ️ О сервисе" : "ℹ️ Про сервіс"],
    ],
    resize_keyboard: true,
  };
}

export function plateHistoryPromptKeyboard(language: Language): Record<string, unknown> {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: language === "ru" ? "AA1234BB" : "AA1234BB",
  };
}

export function insuranceKeyboard(language: Language): Record<string, unknown> {
  return {
    inline_keyboard: [[{
      text: language === "ru" ? "🛡 Открыть проверку МТСБУ" : "🛡 Відкрити перевірку МТСБУ",
      url: "https://policy.mtsbu.ua/Search/Main/",
    }]],
  };
}

export function vehicleReportKeyboard(
  language: Language,
  plate: string | null,
  vin: string | null,
): Record<string, unknown> {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (plate) {
    rows.push([{
      text: language === "ru" ? `📋 Скопировать номер ${plate}` : `📋 Скопіювати номер ${plate}`,
      copy_text: { text: plate },
    }]);
    rows.push([{
      text: language === "ru" ? "🔖 История этого номера" : "🔖 Історія цього номера",
      callback_data: `plate_history:${plate}`,
    }]);
  }
  if (vin) {
    rows.push([{
      text: language === "ru" ? "📊 Полный отчёт" : "📊 Повний звіт",
      callback_data: `full:${vin}`,
    }]);
    rows.push([{
      text: language === "ru" ? "📋 Скопировать VIN" : "📋 Скопіювати VIN",
      copy_text: { text: vin },
    }]);
  }
  rows.push([{
    text: language === "ru" ? "🛡 Проверить страховку в МТСБУ" : "🛡 Перевірити страховку в МТСБУ",
    url: "https://policy.mtsbu.ua/Search/Main/",
  }]);
  return { inline_keyboard: rows };
}

export function candidateKeyboard(
  language: Language,
  plate: string,
  candidates: VehicleCandidate[],
): Record<string, unknown> {
  const rows = candidates.slice(0, 10).map((candidate) => [{
    text: `🚘 ${[candidate.brand, candidate.model].filter(Boolean).join(" ") || (language === "ru" ? "Автомобиль" : "Автомобіль")} · ${candidate.year ?? "—"}`,
    callback_data: `pick:${plate}.${candidate.candidateId}`,
  }]);
  rows.push([{
    text: language === "ru" ? "🔖 История самого номера" : "🔖 Історія самого номера",
    callback_data: `plate_history:${plate}`,
  }]);
  return { inline_keyboard: rows };
}

export function basicReportKeyboard(
  language: Language,
  reference: string,
  plate: string | null,
  vin: string | null = null,
  bidfaxUrl: string | null = null,
): Record<string, unknown> {
  const rows: Array<Array<Record<string, unknown>>> = [
    [{ text: language === "ru" ? "📊 Полный отчёт" : "📊 Повний звіт", callback_data: `full:${reference}` }],
    [{ text: language === "ru" ? "📋 Все регистрации" : "📋 Усі реєстрації", callback_data: `sec:registrations:${reference}` }],
  ];
  if (plate) rows.push([{
    text: language === "ru" ? "🔖 История номера" : "🔖 Історія номера",
    callback_data: `plate_history:${plate}`,
  }]);
  if (vin) {
    rows.push([{
      text: language === "ru" ? `📋 Скопировать VIN ${vin}` : `📋 Скопіювати VIN ${vin}`,
      copy_text: { text: vin },
    }]);
    if (bidfaxUrl) rows.push([{
      text: language === "ru" ? "🔎 Проверить VIN на BidFax" : "🔎 Перевірити VIN на BidFax",
      url: bidfaxUrl,
    }]);
  }
  rows.push(
    [{
      text: language === "ru" ? "🛡 Проверить ОСАГО в МТСБУ" : "🛡 Перевірити ОСЦПВ у МТСБУ",
      url: "https://policy.mtsbu.ua/Search/Main/",
    }],
    [{ text: language === "ru" ? "🔎 Новая проверка" : "🔎 Нова перевірка", callback_data: "new_search" }],
  );
  return { inline_keyboard: rows };
}

export function fullReportKeyboard(language: Language, reference: string): Record<string, unknown> {
  const label = (ru: string, uk: string) => language === "ru" ? ru : uk;
  return {
    inline_keyboard: [
      [
        { text: label("📋 Регистрации", "📋 Реєстрації"), callback_data: `sec:registrations:${reference}` },
        { text: label("👥 Владение", "👥 Володіння"), callback_data: `sec:ownership:${reference}` },
      ],
      [
        { text: "🔢 VIN", callback_data: `sec:vin:${reference}` },
        { text: label("🔖 Номера", "🔖 Номери"), callback_data: `sec:plates:${reference}` },
      ],
      [
        { text: label("🌍 Импорт", "🌍 Імпорт"), callback_data: `sec:import:${reference}` },
        { text: label("🛡 ОСАГО", "🛡 ОСЦПВ"), callback_data: `sec:insurance:${reference}` },
      ],
      [
        { text: label("🇺🇸 США", "🇺🇸 США"), callback_data: `sec:auctions:${reference}` },
        { text: label("🇺🇦 Продажи", "🇺🇦 Продажі"), callback_data: `sec:marketplace:${reference}` },
      ],
      [
        { text: label("📊 Пробег", "📊 Пробіг"), callback_data: `sec:odometer:${reference}` },
        { text: label("⚠️ Аналитика", "⚠️ Аналітика"), callback_data: `sec:analytics:${reference}` },
      ],
      [
        { text: label("📅 Хронология", "📅 Хронологія"), callback_data: `sec:timeline:${reference}` },
        { text: label("ℹ️ Источники", "ℹ️ Джерела"), callback_data: `sec:sources:${reference}` },
      ],
      [{ text: label("📄 Всё сразу", "📄 Усе одразу"), callback_data: `all:${reference}` }],
      [{ text: label("⬅️ К авто", "⬅️ До авто"), callback_data: `back:${reference}` }],
    ],
  };
}

export function sectionKeyboard(
  language: Language,
  reference: string,
  section?: FullReportSection,
  vin: string | null = null,
  bidfaxUrl: string | null = null,
): Record<string, unknown> {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (section === "insurance") {
    rows.push([{
      text: language === "ru" ? "🛡 Проверить ОСАГО в МТСБУ" : "🛡 Перевірити ОСЦПВ у МТСБУ",
      url: "https://policy.mtsbu.ua/Search/Main/",
    }]);
  }
  if (section === "auctions" && vin) {
    rows.push([{
      text: language === "ru" ? "📋 Скопировать VIN" : "📋 Скопіювати VIN",
      copy_text: { text: vin },
    }]);
    rows.push([
      {
        text: "🇺🇸 Copart",
        url: `https://www.copart.com/lotSearchResults?free=true&query=${encodeURIComponent(vin)}`,
      },
      ...(bidfaxUrl ? [{ text: "🔎 BidFax", url: bidfaxUrl }] : []),
    ]);
  }
  if (section === "marketplace") {
    rows.push([{
      text: "AUTO.RIA",
      url: "https://auto.ria.com/uk/",
    }]);
  }
  rows.push([
    { text: language === "ru" ? "⬅️ К разделам" : "⬅️ До розділів", callback_data: `full:${reference}` },
    { text: language === "ru" ? "🚘 К авто" : "🚘 До авто", callback_data: `back:${reference}` },
  ]);
  return {
    inline_keyboard: rows,
  };
}

export function plateHistoryResultKeyboard(
  language: Language,
  entries: Array<{ reference: string; label?: string }>,
): Record<string, unknown> {
  const rows = entries.slice(0, 10).map((entry, index) => [{
    text: entry.label || (language === "ru" ? `🚘 Проверить автомобиль #${index + 1}` : `🚘 Перевірити автомобіль #${index + 1}`),
    callback_data: `pick:${entry.reference}`,
  }]);
  return { inline_keyboard: rows };
}
