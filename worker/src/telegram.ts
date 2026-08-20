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
      [language === "ru" ? "ℹ️ О сервисе" : "ℹ️ Про сервіс"],
    ],
    resize_keyboard: true,
  };
}
