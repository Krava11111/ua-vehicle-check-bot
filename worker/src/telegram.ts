import type { Language } from "./types.js";

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
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
  const result = (await response.json()) as { ok?: boolean; description?: string };
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${result.description ?? "unknown error"}`);
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

export function plateHistoryResultKeyboard(
  language: Language,
  vins: Array<string | null>,
): Record<string, unknown> {
  const rows = vins.slice(0, 10).flatMap((vin, index) => vin ? [[{
    text: language === "ru" ? `🚘 Проверить автомобиль #${index + 1}` : `🚘 Перевірити автомобіль #${index + 1}`,
    callback_data: `vehicle_vin:${vin}`,
  }]] : []);
  return { inline_keyboard: rows };
}
