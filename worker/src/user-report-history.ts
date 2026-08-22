import type { Env, UserReportHistoryItem, VehicleReportData } from "./types.js";

const MAX_HISTORY_ITEMS = 50;

interface HistoryRow {
  id: number;
  report_reference: string;
  vehicle_key: string;
  vin: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  make_year: number | null;
  last_viewed_at: string;
  view_count: number;
}

function item(row: HistoryRow): UserReportHistoryItem {
  return {
    id: row.id,
    reportReference: row.report_reference,
    vehicleKey: row.vehicle_key,
    vin: row.vin,
    plate: row.plate,
    brand: row.brand,
    model: row.model,
    year: row.make_year,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count,
  };
}

export async function rememberUserReport(
  env: Env,
  telegramUserId: number,
  chatId: number,
  report: VehicleReportData,
): Promise<void> {
  if (!env.HISTORY_DB) return;
  const now = new Date().toISOString();
  const vehicle = report.match.vehicle;
  const userId = String(telegramUserId);
  await env.HISTORY_DB.prepare(`
    INSERT INTO user_report_history (
      telegram_user_id, chat_id, report_reference, vehicle_key, vin, plate,
      brand, model, make_year, first_viewed_at, last_viewed_at, view_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (telegram_user_id, vehicle_key) DO UPDATE SET
      chat_id = excluded.chat_id,
      report_reference = excluded.report_reference,
      vin = excluded.vin,
      plate = excluded.plate,
      brand = excluded.brand,
      model = excluded.model,
      make_year = excluded.make_year,
      last_viewed_at = excluded.last_viewed_at,
      view_count = user_report_history.view_count + 1
  `).bind(
    userId,
    String(chatId),
    report.reference,
    report.match.key,
    vehicle.v,
    vehicle.p,
    vehicle.b,
    vehicle.m,
    vehicle.y,
    now,
    now,
  ).run();
  await env.HISTORY_DB.prepare(`
    DELETE FROM user_report_history
    WHERE telegram_user_id = ?
      AND id NOT IN (
        SELECT id FROM user_report_history
        WHERE telegram_user_id = ?
        ORDER BY last_viewed_at DESC, id DESC
        LIMIT ${MAX_HISTORY_ITEMS}
      )
  `).bind(userId, userId).run();
}

export async function listUserReports(
  env: Env,
  telegramUserId: number,
  limit = 10,
): Promise<UserReportHistoryItem[]> {
  if (!env.HISTORY_DB) return [];
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  const result = await env.HISTORY_DB.prepare(`
    SELECT id, report_reference, vehicle_key, vin, plate, brand, model,
           make_year, last_viewed_at, view_count
    FROM user_report_history
    WHERE telegram_user_id = ?
    ORDER BY last_viewed_at DESC, id DESC
    LIMIT ?
  `).bind(String(telegramUserId), safeLimit).all<HistoryRow>();
  return (result.results ?? []).map(item);
}

export async function getUserReport(
  env: Env,
  telegramUserId: number,
  historyId: number,
): Promise<UserReportHistoryItem | null> {
  if (!env.HISTORY_DB || !Number.isSafeInteger(historyId) || historyId <= 0) return null;
  const row = await env.HISTORY_DB.prepare(`
    SELECT id, report_reference, vehicle_key, vin, plate, brand, model,
           make_year, last_viewed_at, view_count
    FROM user_report_history
    WHERE id = ? AND telegram_user_id = ?
  `).bind(historyId, String(telegramUserId)).first<HistoryRow>();
  return row ? item(row) : null;
}

export async function clearUserReports(env: Env, telegramUserId: number): Promise<number> {
  if (!env.HISTORY_DB) return 0;
  const result = await env.HISTORY_DB.prepare(
    "DELETE FROM user_report_history WHERE telegram_user_id = ?",
  ).bind(String(telegramUserId)).run();
  return result.meta?.changes ?? 0;
}
