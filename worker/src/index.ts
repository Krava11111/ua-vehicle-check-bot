import { renderVehicleAnalytics, renderWantedCheck } from "./analytics.js";
import { renderVehicle } from "./format.js";
import { checkWanted, findPlateHistory, findVehicles, loadManifest } from "./index-client.js";
import { detectQuery, languageFor, normalizePlate } from "./normalization.js";
import { renderPlateHistory } from "./plate-history.js";
import {
  insuranceKeyboard,
  mainKeyboard,
  plateHistoryPromptKeyboard,
  plateHistoryResultKeyboard,
  telegramCall,
  vehicleReportKeyboard,
} from "./telegram.js";
import type {
  Env,
  ExecutionContextLike,
  IndexManifest,
  Language,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";

const MEMORY_LIMITS = new Map<string, { minute: number; count: number }>();
const PENDING_PLATE_HISTORY = new Map<string, number>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function textFor(language: Language, key: string): string {
  const messages = {
    uk: {
      welcome: "🚘 <b>Перевірка автомобіля</b>\n\nНадішліть державний номер або VIN-код чи скористайтеся перевіркою страхування.",
      askPlate: "Надішліть державний номер, наприклад <code>AA1234BB</code>.",
      askVin: "Надішліть VIN-код із 17 символів, наприклад <code>WVWZZZ3CZHE123456</code>.",
      askPlateHistory: "🔖 Надішліть номерний знак, історію якого потрібно перевірити, наприклад <code>AA1234BB</code>.",
      invalid: "❌ Не вдалося визначити номер або VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      invalidPlate: "❌ Не вдалося визначити номерний знак. Надішліть його у форматі <code>AA1234BB</code>.",
      notFound: "🔍 <b>Автомобіль не знайдено</b>\n\nПеревірте правильність номера або VIN. Відсутність у відкритому наборі не означає відсутність реєстрації.",
      plateHistoryNotFound: "🔖 <b>Історію номера не знайдено</b>\n\nУ доступних відкритих даних немає зв’язків для цього номера. Це не означає, що номер не видавався або не використовувався раніше.",
      rate: "⚠️ Забагато запитів. Спробуйте через хвилину.",
      unavailable: "⚠️ Джерело даних тимчасово недоступне. Спробуйте пізніше.",
      insurance: "🛡 <b>Перевірка чинності поліса ОСЦПВ</b>\n\nАктуальний результат на обрану дату надає офіційний сервіс МТСБУ. Відкрийте його кнопкою нижче та введіть державний номер або VIN.\n\nℹ️ МТСБУ захищає форму перевірки Turnstile, тому бот не обходить перевірку і не видає технічну помилку за відсутність поліса.",
      about: "ℹ️ Бот шукає в автоматично оновлюваних офіційних відкритих даних МВС і Національної поліції України. Звіт містить історію номера, перевірку відкритого реєстру розшуку, VIN-аналіз та власні аналітичні оцінки з поясненням обмежень. Чинність страхування перевіряється в офіційному сервісі МТСБУ.",
    },
    ru: {
      welcome: "🚘 <b>Проверка автомобиля</b>\n\nОтправьте государственный номер или VIN-код либо воспользуйтесь проверкой страховки.",
      askPlate: "Отправьте государственный номер, например <code>AA1234BB</code>.",
      askVin: "Отправьте VIN-код из 17 символов, например <code>WVWZZZ3CZHE123456</code>.",
      askPlateHistory: "🔖 Отправьте номерной знак, историю которого нужно проверить, например <code>AA1234BB</code>.",
      invalid: "❌ Не удалось определить номер или VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      invalidPlate: "❌ Не удалось определить номерной знак. Отправьте его в формате <code>AA1234BB</code>.",
      notFound: "🔍 <b>Автомобиль не найден</b>\n\nПроверьте правильность номера или VIN. Отсутствие в открытом наборе не означает отсутствие регистрации.",
      plateHistoryNotFound: "🔖 <b>История номера не найдена</b>\n\nВ доступных открытых данных нет связей для этого номера. Это не означает, что номер не выдавался или не использовался раньше.",
      rate: "⚠️ Слишком много запросов. Попробуйте через минуту.",
      unavailable: "⚠️ Источник данных временно недоступен. Попробуйте позднее.",
      insurance: "🛡 <b>Проверка действительности полиса ОСАГО</b>\n\nАктуальный результат на выбранную дату предоставляет официальный сервис МТСБУ. Откройте его кнопкой ниже и введите государственный номер или VIN.\n\nℹ️ МТСБУ защищает форму Turnstile, поэтому бот не обходит проверку и не выдаёт техническую ошибку за отсутствие полиса.",
      about: "ℹ️ Бот ищет в автоматически обновляемых официальных открытых данных МВД и Национальной полиции Украины. Отчёт содержит историю номера, проверку открытого реестра розыска, VIN-анализ и собственные аналитические оценки с объяснением ограничений. Действительность страховки проверяется в официальном сервисе МТСБУ.",
    },
  } as const;
  return messages[language][key as keyof (typeof messages)["uk"]];
}

function historyStartYear(manifest: IndexManifest, env: Env): number {
  const configured = Number(env.VEHICLE_HISTORY_START_YEAR ?? "2013");
  return manifest.history_start_year ?? (Number.isFinite(configured) ? configured : 2013);
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
  for (const [index, part] of parts.entries()) {
    await sendMessage(
      env,
      chatId,
      part,
      index === parts.length - 1
        ? plateHistoryResultKeyboard(language, result.assignments.map((assignment) => assignment[1]))
        : undefined,
    );
  }
}

async function sendVehicleLookup(
  env: Env,
  chatId: number,
  language: Language,
  query: { kind: "PLATE" | "VIN"; normalized: string },
  manifest?: IndexManifest,
): Promise<void> {
  const loadedManifest = manifest ?? await loadManifest(env.INDEX_MANIFEST_URL);
  const matches = await findVehicles(
    query.kind,
    query.normalized,
    loadedManifest,
    Math.max(1, Number(env.MAX_CANDIDATES ?? "3")),
  );
  if (!matches.length) {
    await sendMessage(env, chatId, textFor(language, "notFound"), mainKeyboard(language));
    const wanted = await checkWanted([query.normalized], loadedManifest);
    await sendMessage(
      env,
      chatId,
      renderWantedCheck(wanted, language),
      vehicleReportKeyboard(
        language,
        query.kind === "PLATE" ? query.normalized : null,
        query.kind === "VIN" ? query.normalized : null,
      ),
    );
    return;
  }
  const startYear = historyStartYear(loadedManifest, env);
  for (const match of matches) {
    await sendMessage(env, chatId, renderVehicle(match, loadedManifest, language, startYear));
    const wanted = await checkWanted([match.vehicle.p, match.vehicle.v], loadedManifest);
    await sendMessage(
      env,
      chatId,
      renderVehicleAnalytics(match, wanted, language, new Date(), startYear),
      vehicleReportKeyboard(language, match.vehicle.p, match.vehicle.v),
    );
  }
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
    await sendMessage(
      env,
      message.chat.id,
      textFor(language, "askPlateHistory"),
      plateHistoryPromptKeyboard(language),
    );
    return;
  }
  if (
    text.startsWith("/insurance")
    || text.includes("Перевірити страховку")
    || text.includes("Проверить страховку")
  ) {
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
    const rateLimit = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE ?? "10"));
    if (message.from && isRateLimited(message.from.id, rateLimit)) {
      await sendMessage(env, message.chat.id, textFor(language, "rate"));
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
  const chatId = query.message?.chat.id;
  if (!chatId || !query.data) return;
  const language = languageFor(query.from.language_code, env.DEFAULT_LANGUAGE);
  const rateLimit = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE ?? "10"));
  if (isRateLimited(query.from.id, rateLimit)) {
    await sendMessage(env, chatId, textFor(language, "rate"));
    return;
  }
  try {
    if (query.data.startsWith("plate_history:")) {
      const plate = normalizePlate(query.data.slice("plate_history:".length));
      if (plate) await sendPlateHistory(env, chatId, language, plate);
      return;
    }
    if (query.data.startsWith("vehicle_vin:")) {
      const vehicleQuery = detectQuery(query.data.slice("vehicle_vin:".length));
      if (vehicleQuery?.kind === "VIN") await sendVehicleLookup(env, chatId, language, vehicleQuery);
      return;
    }
    if (query.data.startsWith("vehicle_plate:")) {
      const vehicleQuery = detectQuery(query.data.slice("vehicle_plate:".length));
      if (vehicleQuery?.kind === "PLATE") await sendVehicleLookup(env, chatId, language, vehicleQuery);
    }
  } catch (error) {
    console.error("callback_failed", error instanceof Error ? error.message : String(error));
    await sendMessage(env, chatId, textFor(language, "unavailable"), mainKeyboard(language));
  }
}

async function handleRequest(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    try {
      const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
      return Response.json({
        ok: true,
        indexVersion: manifest.version,
        indexSchema: manifest.schema_version,
        generatedAt: manifest.generated_at,
        historyStartYear: historyStartYear(manifest, env),
        plateHistoryAvailable: manifest.plate_history_available ?? manifest.schema_version >= 4,
        wantedVersion: manifest.wanted?.version ?? null,
        wantedUpdatedAt: manifest.wanted?.dataset_updated_at ?? null,
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
