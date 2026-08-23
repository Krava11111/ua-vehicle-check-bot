import type { Env } from "./types.js";

interface ActivationRow {
  telegram_user_id: string;
}

export async function recordPartnerActivation(env: Env, telegramUserId: number): Promise<void> {
  if (!env.HISTORY_DB) throw new Error("Partner activation storage is unavailable");
  const now = new Date().toISOString();
  await env.HISTORY_DB.prepare(`
    INSERT INTO partner_activations (telegram_user_id, activated_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      updated_at = excluded.updated_at
  `).bind(String(telegramUserId), now, now).run();
}

export async function isPartnerActivated(
  env: Env,
  telegramUserId: number | string,
): Promise<boolean> {
  if (!env.HISTORY_DB) throw new Error("Partner activation storage is unavailable");
  const row = await env.HISTORY_DB.prepare(`
    SELECT telegram_user_id
    FROM partner_activations
    WHERE telegram_user_id = ?
    LIMIT 1
  `).bind(String(telegramUserId)).first<ActivationRow>();
  return row?.telegram_user_id === String(telegramUserId);
}
