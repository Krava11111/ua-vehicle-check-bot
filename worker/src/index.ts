import { renderWantedCheck } from "./analytics.js";
import { refreshExternalProviders } from "./external-providers.js";
import { ExternalHistoryService, importHistory } from "./history.js";
import { checkWanted, findPlateHistory, findVehicles, loadManifest } from "./index-client.js";
import { detectQuery, languageFor, normalizePlate } from "./normalization.js";
import { renderPlateHistory } from "./plate-history.js";
import {
  buildVehicleCandidates,
  candidateId,
  referenceParts,
  VehicleReportAggregator,
} from "./report-aggregator.js";
import { ReportRenderer } from "./report-renderer.js";
import { getReport, putReport } from "./report-state.js";
import {
  basicReportKeyboard,
  candidateKeyboard,
  fullReportKeyboard,
  insuranceKeyboard,
  mainKeyboard,
  plateHistoryPromptKeyboard,
  plateHistoryResultKeyboard,
  sectionKeyboard,
  telegramCall,
  vehicleReportKeyboard,
} from "./telegram.js";
import type {
  Env,
  ExecutionContextLike,
  FullReportSection,
  HistoryImportPayload,
  IndexManifest,
  Language,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  VehicleMatch,
  VehicleReportData,
} from "./types.js";
import type { ProviderRefreshResult } from "./external-providers.js";

const MEMORY_LIMITS = new Map<string, { minute: number; count: number }>();
const PENDING_PLATE_HISTORY = new Map<string, number>();
const PENDING_TTL_MS = 10 * 60 * 1000;
const FULL_SECTIONS = new Set<FullReportSection>([
  "registrations", "ownership", "plates", "vin", "import", "insurance",
  "auctions", "marketplace", "odometer", "analytics", "timeline", "sources",
]);

function textFor(language: Language, key: string): string {
  const messages = {
    uk: {
      welcome: "🚘 <b>Starcar — перевірка автомобіля</b>\n\nНадішліть державний номер або VIN-код.",
      askPlate: "Надішліть державний номер, наприклад <code>AA1234BB</code>.",
      askVin: "Надішліть VIN-код із 17 символів, наприклад <code>WVWZZZ3CZHE123456</code>.",
      askPlateHistory: "🔖 Надішліть номерний знак, історію якого потрібно перевірити, наприклад <code>AA1234BB</code>.",
      invalid: "❌ Не вдалося визначити номер або VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      invalidPlate: "❌ Не вдалося визначити номерний знак. Надішліть його у форматі <code>AA1234BB</code>.",
      notFound: "🔍 <b>Автомобіль не знайдено</b>\n\nПеревірте правильність номера або VIN. Відсутність у відкритому наборі не означає відсутність реєстрації.",
      plateHistoryNotFound: "🔖 <b>Історію номера не знайдено</b>\n\nУ доступних відкритих даних немає зв’язків для цього номера. Це не означає, що номер не використовувався раніше.",
      rate: "⚠️ Забагато запитів. Спробуйте через хвилину.",
      unavailable: "⚠️ Джерело даних тимчасово недоступне. Спробуйте пізніше.",
      reportExpired: "⚠️ Кеш звіту вже недоступний. Надішліть номер або VIN ще раз.",
      insurance: "🛡 <b>Перевірка чинності поліса ОСЦПВ</b>\n\nАктуальний результат на обрану дату надає офіційний сервіс МТСБУ. Відкрийте його кнопкою нижче та введіть номер або VIN.\n\nStarcar не обходить Turnstile і не видає технічну помилку за відсутність поліса.",
      about: "ℹ️ Starcar показує компактну картку з відкритих даних МВС і Національної поліції. Номер не використовується як постійний ідентифікатор: якщо знайдено кілька автомобілів, бот пропонує вибір. Деталі відкриваються розділами повного звіту.",
      newSearch: "🔎 Надішліть новий державний номер або VIN.",
    },
    ru: {
      welcome: "🚘 <b>Starcar — проверка автомобиля</b>\n\nОтправьте государственный номер или VIN-код.",
      askPlate: "Отправьте государственный номер, например <code>AA1234BB</code>.",
      askVin: "Отправьте VIN-код из 17 символов, например <code>WVWZZZ3CZHE123456</code>.",
      askPlateHistory: "🔖 Отправьте номерной знак, историю которого нужно проверить, например <code>AA1234BB</code>.",
      invalid: "❌ Не удалось определить номер или VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      invalidPlate: "❌ Не удалось определить номерной знак. Отправьте его в формате <code>AA1234BB</code>.",
      notFound: "🔍 <b>Автомобиль не найден</b>\n\nПроверьте правильность номера или VIN. Отсутствие в открытом наборе не означает отсутствие регистрации.",
      plateHistoryNotFound: "🔖 <b>История номера не найдена</b>\n\nВ доступных открытых данных нет связей для этого номера. Это не означает, что номер не использовался раньше.",
      rate: "⚠️ Слишком много запросов. Попробуйте через минуту.",
      unavailable: "⚠️ Источник данных временно недоступен. Попробуйте позднее.",
      reportExpired: "⚠️ Кеш отчёта уже недоступен. Отправьте номер или VIN ещё раз.",
      insurance: "🛡 <b>Проверка действительности полиса ОСАГО</b>\n\nАктуальный результат на выбранную дату предоставляет официальный сервис МТСБУ. Откройте его кнопкой ниже и введите номер или VIN.\n\nStarcar не обходит Turnstile и не выдаёт техническую ошибку за отсутствие полиса.",
      about: "ℹ️ Starcar показывает компактную карточку из открытых данных МВД и Национальной полиции. Номер не используется как постоянный идентификатор: если найдено несколько автомобилей, бот предлагает выбор. Детали открываются разделами полного отчёта.",
      newSearch: "🔎 Отправьте новый государственный номер или VIN.",
    },
  } as const;
  return messages[language][key as keyof (typeof messages)["uk"]];
}

function historyStartYear(manifest: IndexManifest, env: Env): number {
  const configured = Number(env.VEHICLE_HISTORY_START_YEAR ?? "2013");
  return manifest.history_start_year ?? (Number.isFinite(configured) ? configured : 2013);
}

function maxCandidates(env: Env): number {
  return Math.max(2, Number(env.MAX_CANDIDATES ?? "10"));
}

function pendingKey(chatId: number, userId: number | undefined): string {
  return `${chatId}:${userId ?? 0}`;
}

function isPlateHistoryReply(message: TelegramMessage, language: Language): boolean {
  const repliedText = message.reply_to_message?.text ?? "";
  return repliedText === textFor(language, "askPlateHistory")
    || repliedText.includes("історію якого потрібно перевірити")
    || repliedText.includes("историю которого нужно проверить");
}

function consumePendingPlateHistory(message: TelegramMessage): boolean {
  const key = pendingKey(message.chat.id, message.from?.id);
  const expiresAt = PENDING_PLATE_HISTORY.get(key) ?? 0;
  PENDING_PLATE_HISTORY.delete(key);
  return expiresAt > Date.now();
}

function isRateLimited(userId: number, limit: number): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const key = String(userId);
  const current = MEMORY_LIMITS.get(key);
  if (!current || current.minute !== minute) {
    MEMORY_LIMITS.set(key, { minute, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  await telegramCall(env.BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function editMessage(
  env: Env,
  message: TelegramMessage,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  try {
    await telegramCall(env.BOT_TOKEN, "editMessageText", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("message is not modified")) return;
    throw error;
  }
}

async function sendPlateHistory(
  env: Env,
  chatId: number,
  language: Language,
  plate: string,
  manifest?: IndexManifest,
): Promise<void> {
  const loadedManifest = manifest ?? await loadManifest(env.INDEX_MANIFEST_URL);
  const result = await findPlateHistory(
    plate,
    loadedManifest,
    Math.max(1, Number(env.MAX_PLATE_HISTORY_CANDIDATES ?? "20")),
  );
  if (!result.assignments.length) {
    await sendMessage(env, chatId, textFor(language, "plateHistoryNotFound"), mainKeyboard(language));
    return;
  }
  const parts = renderPlateHistory(
    result,
    language,
    historyStartYear(loadedManifest, env),
    loadedManifest.source_label,
    loadedManifest.source_url,
  );
  const entries = await Promise.all(result.assignments.map(async (assignment) => ({
    reference: `${plate}.${await candidateId(assignment[0])}`,
    label: `🚘 ${[assignment[2], assignment[3]].filter(Boolean).join(" ") || (language === "ru" ? "Автомобиль" : "Автомобіль")} · ${assignment[4] ?? "—"}`,
  })));
  for (const [index, part] of parts.entries()) {
    await sendMessage(
      env,
      chatId,
      part,
      index === parts.length - 1 ? plateHistoryResultKeyboard(language, entries) : undefined,
    );
  }
}

async function findCandidate(
  reference: string,
  manifest: IndexManifest,
  env: Env,
): Promise<VehicleMatch | null> {
  const parsed = referenceParts(reference);
  if (!parsed?.plate) return null;
  const matches = await findVehicles("PLATE", parsed.plate, manifest, maxCandidates(env));
  for (const match of matches) {
    if (await candidateId(match.key) === parsed.candidateId) return match;
  }
  return null;
}

async function aggregate(
  match: VehicleMatch,
  manifest: IndexManifest,
  env: Env,
): Promise<VehicleReportData> {
  const wanted = await checkWanted([match.vehicle.p, match.vehicle.v], manifest);
  const vin = match.vehicle.v;
  let external = null;
  let providerStatus: ProviderRefreshResult = {
    autoRia: env.AUTO_RIA_API_KEY ? "connected" as const : "not_configured" as const,
    auctions: env.AUCTION_API_KEY ? "connected" as const : "not_configured" as const,
    checkedAt: new Date().toISOString(),
  };
  if (vin) {
    try {
      providerStatus = await refreshExternalProviders(vin, env);
    } catch (error) {
      console.error("external_provider_refresh_failed", error instanceof Error ? error.message : String(error));
    }
    try {
      external = await new ExternalHistoryService().getByVin(vin, match, env);
    } catch (error) {
      console.error("external_history_read_failed", error instanceof Error ? error.message : String(error));
    }
  }
  const report = await VehicleReportAggregator.build(
    match,
    manifest,
    wanted,
    historyStartYear(manifest, env),
    external,
    providerStatus,
    env.BIDFAX_BASE_URL ?? "https://bidfax.co/",
  );
  await putReport(report);
  return report;
}

async function reportForReference(
  reference: string,
  env: Env,
): Promise<VehicleReportData | null> {
  const cached = await getReport(reference);
  if (cached) return cached;
  const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
  const match = await findCandidate(reference, manifest, env);
  return match ? aggregate(match, manifest, env) : null;
}

async function showBasicReport(
  report: VehicleReportData,
  language: Language,
  env: Env,
  target: number | TelegramMessage,
): Promise<void> {
  const keyboard = basicReportKeyboard(
    language,
    report.reference,
    report.match.vehicle.p,
    report.match.vehicle.v,
    report.externalHistory?.bidfaxUrl,
    report.match.candidates > 1,
  );
  const text = ReportRenderer.renderBasicReport(report, language);
  if (typeof target === "number") await sendMessage(env, target, text, keyboard);
  else await editMessage(env, target, text, keyboard);
}

async function sendVehicleLookup(
  env: Env,
  chatId: number,
  language: Language,
  query: { kind: "PLATE" | "VIN"; normalized: string },
  manifest?: IndexManifest,
): Promise<void> {
  const loadedManifest = manifest ?? await loadManifest(env.INDEX_MANIFEST_URL);
  const matches = await findVehicles(query.kind, query.normalized, loadedManifest, maxCandidates(env));
  if (!matches.length) {
    const wanted = await checkWanted([query.normalized], loadedManifest);
    await sendMessage(
      env,
      chatId,
      `${textFor(language, "notFound")}\n\n${renderWantedCheck(wanted, language)}`,
      vehicleReportKeyboard(
        language,
        query.kind === "PLATE" ? query.normalized : null,
        query.kind === "VIN" ? query.normalized : null,
      ),
    );
    return;
  }
  // Plate matches are sorted by their latest known assignment date. Show the
  // newest one immediately; older assignments remain available from the card.
  await showBasicReport(await aggregate(matches[0] as VehicleMatch, loadedManifest, env), language, env, chatId);
}

async function handleMessage(message: TelegramMessage, env: Env): Promise<void> {
  const language = languageFor(message.from?.language_code, env.DEFAULT_LANGUAGE);
  const text = message.text?.trim() ?? "";
  if (text.startsWith("/start") || text === "/uk" || text === "/ru") {
    const selected = text === "/ru" ? "ru" : text === "/uk" ? "uk" : language;
    await sendMessage(env, message.chat.id, textFor(selected, "welcome"), mainKeyboard(selected));
    return;
  }
  if (text.includes("Перевірити за номером") || text.includes("Проверить по номеру")) {
    await sendMessage(env, message.chat.id, textFor(language, "askPlate"));
    return;
  }
  if (text.includes("Перевірити за VIN") || text.includes("Проверить по VIN")) {
    await sendMessage(env, message.chat.id, textFor(language, "askVin"));
    return;
  }
  if (text.includes("Історія номера") || text.includes("История номера")) {
    PENDING_PLATE_HISTORY.set(pendingKey(message.chat.id, message.from?.id), Date.now() + PENDING_TTL_MS);
    await sendMessage(env, message.chat.id, textFor(language, "askPlateHistory"), plateHistoryPromptKeyboard(language));
    return;
  }
  if (text.startsWith("/insurance") || text.includes("Перевірити страховку") || text.includes("Проверить страховку")) {
    await sendMessage(env, message.chat.id, textFor(language, "insurance"), insuranceKeyboard(language));
    return;
  }
  if (text.includes("Про сервіс") || text.includes("О сервисе")) {
    await sendMessage(env, message.chat.id, textFor(language, "about"), mainKeyboard(language));
    return;
  }

  const commandMatch = /^\/plate_history(?:@\w+)?(?:\s+(.+))?$/i.exec(text);
  const pendingHistory = consumePendingPlateHistory(message);
  const historyRequested = Boolean(commandMatch) || isPlateHistoryReply(message, language) || pendingHistory;
  if (historyRequested) {
    const plate = normalizePlate(commandMatch?.[1] ?? text);
    if (!plate) {
      await sendMessage(env, message.chat.id, textFor(language, "invalidPlate"), mainKeyboard(language));
      return;
    }
    try {
      await sendPlateHistory(env, message.chat.id, language, plate);
    } catch (error) {
      console.error("plate_history_failed", error instanceof Error ? error.message : String(error));
      await sendMessage(env, message.chat.id, textFor(language, "unavailable"), mainKeyboard(language));
    }
    return;
  }

  const query = detectQuery(text);
  if (!query) {
    await sendMessage(env, message.chat.id, textFor(language, "invalid"), mainKeyboard(language));
    return;
  }
  const rateLimit = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE ?? "10"));
  if (message.from && isRateLimited(message.from.id, rateLimit)) {
    await sendMessage(env, message.chat.id, textFor(language, "rate"));
    return;
  }
  try {
    await sendVehicleLookup(env, message.chat.id, language, query);
  } catch (error) {
    console.error("vehicle_lookup_failed", error instanceof Error ? error.message : String(error));
    await sendMessage(env, message.chat.id, textFor(language, "unavailable"), mainKeyboard(language));
  }
}

async function handleCallback(query: TelegramCallbackQuery, env: Env): Promise<void> {
  await telegramCall(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: query.id });
  const message = query.message;
  if (!message || !query.data) return;
  const language = languageFor(query.from.language_code, env.DEFAULT_LANGUAGE);
  try {
    if (query.data === "new_search") {
      await sendMessage(env, message.chat.id, textFor(language, "newSearch"), mainKeyboard(language));
      return;
    }
    if (query.data.startsWith("plate_history:")) {
      const plate = normalizePlate(query.data.slice("plate_history:".length));
      if (plate) await sendPlateHistory(env, message.chat.id, language, plate);
      return;
    }
    if (query.data.startsWith("candidates:")) {
      const plate = normalizePlate(query.data.slice("candidates:".length));
      if (!plate) return;
      const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
      const matches = await findVehicles("PLATE", plate, manifest, maxCandidates(env));
      const candidates = await buildVehicleCandidates(matches, plate);
      await editMessage(
        env,
        message,
        ReportRenderer.renderCandidateSelector(plate, candidates, language),
        candidateKeyboard(language, plate, candidates),
      );
      return;
    }
    if (query.data.startsWith("pick:")) {
      const reference = query.data.slice("pick:".length);
      const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
      const match = await findCandidate(reference, manifest, env);
      if (!match) {
        await sendMessage(env, message.chat.id, textFor(language, "reportExpired"));
        return;
      }
      await showBasicReport(await aggregate(match, manifest, env), language, env, message);
      return;
    }
    if (query.data.startsWith("full:")) {
      const reference = query.data.slice("full:".length);
      const report = await reportForReference(reference, env);
      if (!report) {
        await sendMessage(env, message.chat.id, textFor(language, "reportExpired"));
        return;
      }
      await editMessage(env, message, ReportRenderer.renderFullReportSummary(report, language), fullReportKeyboard(language, reference));
      return;
    }
    if (query.data.startsWith("back:")) {
      const reference = query.data.slice("back:".length);
      const report = await reportForReference(reference, env);
      if (report) await showBasicReport(report, language, env, message);
      else await sendMessage(env, message.chat.id, textFor(language, "reportExpired"));
      return;
    }
    if (query.data.startsWith("sec:")) {
      const [, rawSection, reference] = /^sec:([^:]+):(.+)$/.exec(query.data) ?? [];
      if (!rawSection || !reference || !FULL_SECTIONS.has(rawSection as FullReportSection)) return;
      const report = await reportForReference(reference, env);
      if (!report) {
        await sendMessage(env, message.chat.id, textFor(language, "reportExpired"));
        return;
      }
      const section = rawSection as FullReportSection;
      const parts = ReportRenderer.renderSection(report, section, language);
      const keyboard = sectionKeyboard(
        language,
        reference,
        section,
        report.match.vehicle.v,
        report.externalHistory?.bidfaxUrl,
      );
      await editMessage(env, message, parts[0] ?? "—", keyboard);
      for (const part of parts.slice(1)) await sendMessage(env, message.chat.id, part, keyboard);
      return;
    }
    if (query.data.startsWith("all:")) {
      const reference = query.data.slice("all:".length);
      const report = await reportForReference(reference, env);
      if (!report) {
        await sendMessage(env, message.chat.id, textFor(language, "reportExpired"));
        return;
      }
      const parts = ReportRenderer.renderAll(report, language);
      await editMessage(
        env,
        message,
        parts[0] ?? "—",
        parts.length === 1 ? fullReportKeyboard(language, reference) : undefined,
      );
      for (const [index, part] of parts.slice(1).entries()) {
        await sendMessage(env, message.chat.id, part, index === parts.length - 2 ? fullReportKeyboard(language, reference) : undefined);
      }
      return;
    }
    // Backward compatibility for buttons sent by the previous Worker version.
    if (query.data.startsWith("vehicle_vin:")) {
      const vehicleQuery = detectQuery(query.data.slice("vehicle_vin:".length));
      if (vehicleQuery?.kind === "VIN") await sendVehicleLookup(env, message.chat.id, language, vehicleQuery);
      return;
    }
    if (query.data.startsWith("vehicle_plate:")) {
      const vehicleQuery = detectQuery(query.data.slice("vehicle_plate:".length));
      if (vehicleQuery?.kind === "PLATE") await sendVehicleLookup(env, message.chat.id, language, vehicleQuery);
    }
  } catch (error) {
    console.error("callback_failed", error instanceof Error ? error.message : String(error));
    await sendMessage(env, message.chat.id, textFor(language, "unavailable"), mainKeyboard(language));
  }
}

function adminAuthorized(request: Request, env: Env): boolean {
  if (!env.HISTORY_IMPORT_SECRET) return false;
  return request.headers.get("Authorization") === `Bearer ${env.HISTORY_IMPORT_SECRET}`;
}

async function registerTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!adminAuthorized(request, env)) return new Response("Forbidden", { status: 403 });
  const origin = new URL(request.url).origin;
  const webhookPath = env.WEBHOOK_SECRET_PATH.replace(/^\/+|\/+$/g, "");
  await telegramCall(env.BOT_TOKEN, "setWebhook", {
    url: `${origin}/${webhookPath}`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return Response.json({ ok: true, webhook: `${origin}/***`, allowedUpdates: ["message", "callback_query"] });
}

async function importHistoryRequest(request: Request, env: Env): Promise<Response> {
  if (!adminAuthorized(request, env)) return new Response("Forbidden", { status: 403 });
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > 1_000_000) return new Response("Payload too large", { status: 413 });
  try {
    const payload = (await request.json()) as HistoryImportPayload;
    return Response.json({ ok: true, ...(await importHistory(payload, env)) });
  } catch (error) {
    console.error("history_import_failed", error instanceof Error ? error.message : String(error));
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_import" }, { status: 400 });
  }
}

async function handleRequest(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/admin/history/import") {
    return importHistoryRequest(request, env);
  }
  if (request.method === "POST" && url.pathname === "/admin/register-webhook") {
    return registerTelegramWebhook(request, env);
  }
  if (request.method === "GET" && url.pathname === "/health") {
    try {
      const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
      return Response.json({
        ok: true,
        service: "Starcar",
        reportUi: 2,
        indexVersion: manifest.version,
        indexSchema: manifest.schema_version,
        generatedAt: manifest.generated_at,
        historyStartYear: historyStartYear(manifest, env),
        plateHistoryAvailable: manifest.plate_history_available ?? manifest.schema_version >= 4,
        vehicleClustering: manifest.schema_version >= 5 ? "vin-stable-id-characteristics" : "legacy",
        wantedVersion: manifest.wanted?.version ?? null,
        wantedUpdatedAt: manifest.wanted?.dataset_updated_at ?? null,
        historyStorage: env.HISTORY_DB ? "d1" : "unavailable",
        externalProviders: {
          autoRia: env.AUTO_RIA_API_KEY ? "configured" : "not_configured",
          copartIaai: env.AUCTION_API_KEY ? "configured" : "not_configured",
          bidfax: "external_vin_check",
        },
      });
    } catch {
      return Response.json({ ok: false, error: "index_unavailable" }, { status: 503 });
    }
  }
  const expectedPath = `/${env.WEBHOOK_SECRET_PATH.replace(/^\/+|\/+$/g, "")}`;
  if (request.method !== "POST" || url.pathname !== expectedPath) return new Response("Not found", { status: 404 });
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (update.callback_query) context.waitUntil(handleCallback(update.callback_query, env));
  else if (update.message?.text) context.waitUntil(handleMessage(update.message, env));
  return new Response("OK");
}

export default { fetch: handleRequest };
export { handleRequest };
