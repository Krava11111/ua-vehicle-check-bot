import { renderVehicle } from "./format.js";
import { findVehicles, loadManifest } from "./index-client.js";
import { detectQuery, languageFor } from "./normalization.js";
import { insuranceKeyboard, mainKeyboard, telegramCall } from "./telegram.js";
import type { Env, ExecutionContextLike, Language, TelegramMessage, TelegramUpdate } from "./types.js";

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
      about: "ℹ️ Бот шукає в автоматично оновлюваному індексі офіційних відкритих даних МВС України. Набір оновлюється розпорядником приблизно раз на місяць. Чинність страхування перевіряється в офіційному сервісі МТСБУ.",
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
      about: "ℹ️ Бот ищет в автоматически обновляемом индексе официальных открытых данных МВД Украины. Набор обновляется распорядителем приблизительно раз в месяц. Действительность страховки проверяется в официальном сервисе МТСБУ.",
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
      return;
    }
    for (const match of matches) await send(renderVehicle(match, manifest, language));
  } catch (error) {
    console.error("vehicle_lookup_failed", error instanceof Error ? error.message : String(error));
    await send(textFor(language, "unavailable"), true);
  }
}

async function handleRequest(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    try {
      const manifest = await loadManifest(env.INDEX_MANIFEST_URL);
      return Response.json({ ok: true, indexVersion: manifest.version, generatedAt: manifest.generated_at });
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
  return new Response("OK");
}

export default { fetch: handleRequest };
export { handleRequest };
