import { renderVehicleAnalytics, renderWantedCheck } from "./analytics.js";
import { renderVehicle } from "./format.js";
import { renderExternalHistory } from "./history-format.js";
import { ExternalHistoryService, importHistory } from "./history.js";
import { checkWanted, findVehicles, loadManifest } from "./index-client.js";
import { detectQuery, languageFor } from "./normalization.js";
import { insuranceKeyboard, mainKeyboard, telegramCall, vehicleReportKeyboard } from "./telegram.js";
import type {
  Env,
  ExecutionContextLike,
  HistoryImportPayload,
  Language,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";

const MEMORY_LIMITS = new Map<string, { minute: number; count: number }>();

function textFor(language: Language, key: string): string {
  const messages = {
    uk: {
      welcome: "🚘 <b>Перевірка автомобіля</b>\n\nНадішліть державний номер або VIN-код чи скористайтеся перевіркою страхування.",
      askPlate: "Надішліть державний номер, наприклад <code>AA1234BB</code>.",
      askVin: "Надішліть VIN-код із 17 символів, наприклад <code>WVWZZZ3CZHE123456</code>.",
      invalid: "❌ Не вдалося визначити номер або VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      notFound: "🔍 <b>Автомобіль не знайдено</b>\n\nПеревірте правильність номера або VIN. Відсутність у відкритому наборі не означає відсутність реєстрації.",
      rate: "⚠️ Забагато запитів. Спробуйте через хвилину.",
      unavailable: "⚠️ Джерело даних тимчасово недоступне. Спробуйте пізніше.",
      insurance: "🛡 <b>Перевірка чинності поліса ОСЦПВ</b>\n\nАктуальний результат на обрану дату надає офіційний сервіс МТСБУ. Відкрийте його кнопкою нижче та введіть державний номер або VIN.\n\nℹ️ МТСБУ захищає форму перевірки Turnstile, тому бот не обходить перевірку і не видає технічну помилку за відсутність поліса.",
      about: "ℹ️ Бот шукає в автоматично оновлюваних офіційних відкритих даних МВС і Національної поліції України. Звіт містить перевірку відкритого реєстру розшуку, VIN-аналіз та власні аналітичні оцінки з поясненням обмежень. Чинність страхування перевіряється в офіційному сервісі МТСБУ.",
    },
    ru: {
      welcome: "🚘 <b>Проверка автомобиля</b>\n\nОтправьте государственный номер или VIN-код либо воспользуйтесь проверкой страховки.",
      askPlate: "Отправьте государственный номер, например <code>AA1234BB</code>.",
      askVin: "Отправьте VIN-код из 17 символов, например <code>WVWZZZ3CZHE123456</code>.",
      invalid: "❌ Не удалось определить номер или VIN.\n\nНомер: <code>AA1234BB</code>\nVIN: <code>WVWZZZ3CZHE123456</code>",
      notFound: "🔍 <b>Автомобиль не найден</b>\n\nПроверьте правильность номера или VIN. Отсутствие в открытом наборе не означает отсутствие регистрации.",
      rate: "⚠️ Слишком много запросов. Попробуйте через минуту.",
      unavailable: "⚠️ Источник данных временно недоступен. Попробуйте позднее.",
      insurance: "🛡 <b>Проверка действительности полиса ОСАГО</b>\n\nАктуальный результат на выбранную дату предоставляет официальный сервис МТСБУ. Откройте его кнопкой ниже и введите государственный номер или VIN.\n\nℹ️ МТСБУ защищает форму Turnstile, поэтому бот не обходит проверку и не выдаёт техническую ошибку за отсутствие полиса.",
      about: "ℹ️ Бот ищет в автоматически обновляемых официальных открытых данных МВД и Национальной полиции Украины. Отчёт содержит проверку открытого реестра розыска, VIN-анализ и собственные аналитические оценки с объяснением ограничений. Действительность страховки проверяется в официальном сервисе МТСБУ.",
    },
  } as const;
  return messages[language][key as keyof (typeof messages)["uk"]];
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

async function answer(env: Env, chatId: number, text: string, keyboard = false): Promise<void> {
  await telegramCall(env.BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: mainKeyboard("uk") } : {}),
  });
}

async function handleMessage(message: TelegramMessage, env: Env): Promise<void> {
  const language = languageFor(message.from?.language_code, env.DEFAULT_LANGUAGE);
  const text = message.text?.trim() ?? "";
  const send = (body: string, keyboard = false) => telegramCall(env.BOT_TOKEN, "sendMessage", {
    chat_id: message.chat.id,
    text: body,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: mainKeyboard(language) } : {}),
  });

  if (text.startsWith("/start") || text === "/uk" || text === "/ru") {
    const selected = text === "/ru" ? "ru" : text === "/uk" ? "uk" : language;
    await telegramCall(env.BOT_TOKEN, "sendMessage", {
      chat_id: message.chat.id,
      text: textFor(selected, "welcome"),
      parse_mode: "HTML",
      reply_markup: mainKeyboard(selected),
    });
    return;
  }
  if (text.includes("Перевірити за номером") || text.includes("Проверить по номеру")) {
    await send(textFor(language, "askPlate"));
    return;
  }
  if (text.includes("Перевірити за VIN") || text.includes("Проверить по VIN")) {
    await send(textFor(language, "askVin"));
    return;
  }
  if (
    text.startsWith("/insurance")
    || text.includes("Перевірити страховку")
    || text.includes("Проверить страховку")
  ) {
    await telegramCall(env.BOT_TOKEN, "sendMessage", {
      chat_id: message.chat.id,
      text: textFor(language, "insurance"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: insuranceKeyboard(language),
    });
    return;
  }
  if (text.includes("Про сервіс") || text.includes("О сервисе")) {
    await send(textFor(language, "about"), true);
    return;
  }
  const query = detectQuery(text);
  if (!query) {
    await send(textFor(language, "invalid"), true);
    return;
  }
  const rateLimit = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE ?? "10"));
  if (message.from && isRateLimited(message.from.id, rateLimit)) {
    await send(textFor(language, "rate"));
    return;
  }
  try {
    const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
    const matches = await findVehicles(
      query.kind,
      query.normalized,
      manifest,
      Math.max(1, Number(env.MAX_CANDIDATES ?? "3")),
    );
    if (!matches.length) {
      await send(textFor(language, "notFound"), true);
      const wanted = await checkWanted([query.normalized], manifest);
      await telegramCall(env.BOT_TOKEN, "sendMessage", {
        chat_id: message.chat.id,
        text: renderWantedCheck(wanted, language),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: vehicleReportKeyboard(
          language,
          query.kind === "PLATE" ? query.normalized : null,
          query.kind === "VIN" ? query.normalized : null,
        ),
      });
      return;
    }
    for (const match of matches) {
      await telegramCall(env.BOT_TOKEN, "sendMessage", {
        chat_id: message.chat.id,
        text: renderVehicle(match, manifest, language),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      const wanted = await checkWanted([match.vehicle.p, match.vehicle.v], manifest);
      await telegramCall(env.BOT_TOKEN, "sendMessage", {
        chat_id: message.chat.id,
        text: renderVehicleAnalytics(match, wanted, language),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: vehicleReportKeyboard(language, match.vehicle.p, match.vehicle.v),
      });
    }
  } catch (error) {
    console.error("vehicle_lookup_failed", error instanceof Error ? error.message : String(error));
    await send(textFor(language, "unavailable"), true);
  }
}

async function handleCallback(callback: TelegramCallbackQuery, env: Env): Promise<void> {
  await telegramCall(env.BOT_TOKEN, "answerCallbackQuery", {
    callback_query_id: callback.id,
  });
  const data = callback.data ?? "";
  const chatId = callback.message?.chat.id;
  if (!chatId || !data.startsWith("full:")) return;
  const vin = data.slice(5).toUpperCase();
  const language = languageFor(callback.from.language_code, env.DEFAULT_LANGUAGE);
  try {
    const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
    const matches = await findVehicles("VIN", vin, manifest, 1);
    const match = matches[0];
    if (!match) {
      await answer(env, chatId, textFor(language, "notFound"));
      return;
    }
    const wanted = await checkWanted([match.vehicle.p, match.vehicle.v], manifest);
    await telegramCall(env.BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: renderVehicle(match, manifest, language),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    await telegramCall(env.BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: renderVehicleAnalytics(match, wanted, language),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    const history = await new ExternalHistoryService().getByVin(vin, match, env);
    const parts = renderExternalHistory(history, match, language);
    for (const [index, part] of parts.entries()) {
      await telegramCall(env.BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(index === parts.length - 1
          ? { reply_markup: vehicleReportKeyboard(language, match.vehicle.p, match.vehicle.v) }
          : {}),
      });
    }
  } catch (error) {
    console.error("full_report_failed", error instanceof Error ? error.message : String(error));
    await answer(env, chatId, textFor(language, "unavailable"));
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
        indexVersion: manifest.version,
        generatedAt: manifest.generated_at,
        wantedVersion: manifest.wanted?.version ?? null,
        wantedUpdatedAt: manifest.wanted?.dataset_updated_at ?? null,
        historyStorage: env.HISTORY_DB ? "d1" : "unavailable",
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
  if (update.message?.text) context.waitUntil(handleMessage(update.message, env));
  else if (update.callback_query?.data) context.waitUntil(handleCallback(update.callback_query, env));
  return new Response("OK");
}

export default { fetch: handleRequest };
export { handleRequest };
