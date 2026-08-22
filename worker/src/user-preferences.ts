import type { Env, Language } from "./types.js";

interface PreferenceRow {
  language: string;
}

function supportedLanguage(value: string | null | undefined): value is Language {
  return value === "uk" || value === "ru";
}

export async function getUserLanguage(env: Env, telegramUserId: number): Promise<Language | null> {
  if (!env.HISTORY_DB) return null;
  const row = await env.HISTORY_DB.prepare(
    "SELECT language FROM user_preferences WHERE telegram_user_id = ?",
  ).bind(String(telegramUserId)).first<PreferenceRow>();
  return supportedLanguage(row?.language) ? row.language : null;
}

export async function setUserLanguage(
  env: Env,
  telegramUserId: number,
  language: Language,
): Promise<void> {
  if (!env.HISTORY_DB) throw new Error("User preference storage is unavailable");
  const now = new Date().toISOString();
  await env.HISTORY_DB.prepare(`
    INSERT INTO user_preferences (telegram_user_id, language, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      language = excluded.language,
      updated_at = excluded.updated_at
  `).bind(String(telegramUserId), language, now, now).run();
}
