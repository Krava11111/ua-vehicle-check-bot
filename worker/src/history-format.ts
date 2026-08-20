import type { ExternalVehicleHistory, Language, MarketplaceSnapshot, VehicleMatch } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value.slice(0, 10));
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

function formatMoney(value: number | null, currency: string | null): string {
  return value === null ? "—" : `${Math.round(value).toLocaleString("uk-UA")} ${escapeHtml(currency ?? "")}`.trim();
}

function formatMileage(value: number | null, unit: string | null, km: number | null): string {
  if (value === null) return "—";
  const original = `${Math.round(value).toLocaleString("uk-UA")} ${escapeHtml(unit ?? "")}`.trim();
  return km !== null && !["km", "км"].includes((unit ?? "").toLowerCase())
    ? `${original} ≈ ${km.toLocaleString("uk-UA")} км`
    : original;
}

function splitMessage(message: string, limit = 3_900): string[] {
  if (message.length <= limit) return [message];
  const result: string[] = [];
  let current = "";
  for (const line of message.split("\n")) {
    if (current && current.length + line.length + 1 > limit) {
      result.push(current);
      current = "";
    }
    if (line.length > limit) {
      for (let index = 0; index < line.length; index += limit) result.push(line.slice(index, index + limit));
    } else {
      current += `${current ? "\n" : ""}${line}`;
    }
  }
  if (current) result.push(current);
  return result;
}

function priceHistory(snapshots: MarketplaceSnapshot[], language: Language): string[] {
  const prices = snapshots.filter((item) => item.price !== null);
  if (!prices.length) return [];
  const lines = [`💰 <b>${language === "ru" ? "История цены" : "Історія ціни"}</b>`];
  let previous: number | null = null;
  for (const snapshot of prices.slice(-10)) {
    const delta = previous === null || snapshot.price === null
      ? ""
      : ` (${snapshot.price - previous > 0 ? "+" : ""}${Math.round(snapshot.price - previous).toLocaleString("uk-UA")})`;
    lines.push(`${formatDate(snapshot.observedAt)} · ${formatMoney(snapshot.price, snapshot.currency)}${delta}`);
    previous = snapshot.price;
  }
  const first = prices[0]?.price ?? null;
  const last = prices.at(-1)?.price ?? null;
  if (first && last) {
    const percent = ((last - first) / first) * 100;
    lines.push(`${language === "ru" ? "Общее изменение" : "Загальна зміна"}: ${formatMoney(first, prices[0]?.currency ?? null)} → ${formatMoney(last, prices.at(-1)?.currency ?? null)} (${percent > 0 ? "+" : ""}${percent.toFixed(1)}%)`);
  }
  return lines;
}

export function renderExternalHistory(
  history: ExternalVehicleHistory,
  match: VehicleMatch,
  language: Language,
): string[] {
  const ru = language === "ru";
  const damage = history.auctions.find((item) => item.primaryDamage)?.primaryDamage ?? null;
  const photoCount = history.auctions.reduce((total, item) => total + item.photos.length, 0);
  const warningCount = history.odometerWarnings.length + history.crossSourceWarnings.length;
  const sections: string[] = [];

  const summary = [
    `📊 <b>${ru ? "ПОЛНОЕ РЕЗЮМЕ" : "ПОВНЕ РЕЗЮМЕ"}</b>`,
    `🇺🇸 ${ru ? "Аукционных событий" : "Аукціонних подій"}: ${history.auctions.length}`,
    `💥 ${ru ? "Повреждения из источников" : "Пошкодження з джерел"}: ${damage ? escapeHtml(damage) : ru ? "данных нет" : "даних немає"}`,
    `📸 ${ru ? "Ссылок на фотографии" : "Посилань на фотографії"}: ${photoCount}`,
    `🇺🇦 ${ru ? "Регистраций МВД" : "Реєстрацій МВС"}: ${match.vehicle.e.length}`,
    `💰 ${ru ? "Известных объявлений" : "Відомих оголошень"}: ${history.marketplace.length}`,
    `📊 ${ru ? "Записей пробега" : "Записів пробігу"}: ${history.mileage.length}`,
    `⚠️ ${ru ? "Предупреждений" : "Попереджень"}: ${warningCount}`,
  ];
  if (!history.storageAvailable) {
    summary.push("", ru
      ? "⚪ Cloudflare D1 для дополнительной истории не подключена. Основной отчёт МВД и розыск продолжают работать."
      : "⚪ Cloudflare D1 для додаткової історії не підключена. Основний звіт МВС і розшук продовжують працювати.");
  }
  sections.push(summary.join("\n"));

  const auctions = [`🇺🇸 <b>${ru ? "АУКЦИОНЫ США" : "АУКЦІОНИ США"}</b>`];
  if (!history.auctions.length) auctions.push(ru
    ? "В подключённых легальных источниках аукционных записей не найдено. Это не означает, что автомобиль никогда не продавался на аукционе."
    : "У підключених легальних джерелах аукціонних записів не знайдено. Це не означає, що автомобіль ніколи не продавався на аукціоні.");
  for (const [index, event] of history.auctions.entries()) {
    auctions.push("", `${index + 1}️⃣ <b>${escapeHtml(event.auctionName ?? event.provider)}</b>`);
    if (event.auctionDate) auctions.push(`${ru ? "Дата" : "Дата"}: ${formatDate(event.auctionDate)}`);
    if (event.lotNumber) auctions.push(`${ru ? "Лот" : "Лот"}: <code>${escapeHtml(event.lotNumber)}</code>`);
    if (event.location) auctions.push(`📍 ${escapeHtml(event.location)}`);
    if (event.odometer !== null) auctions.push(`📊 ${formatMileage(event.odometer, event.odometerUnit, event.normalizedOdometerKm)}`);
    if (event.primaryDamage) auctions.push(`💥 ${ru ? "Основное повреждение" : "Основне пошкодження"}: ${escapeHtml(event.primaryDamage)}`);
    if (event.secondaryDamage) auctions.push(`${ru ? "Дополнительное" : "Додаткове"}: ${escapeHtml(event.secondaryDamage)}`);
    if (event.titleType) auctions.push(`Title: ${escapeHtml(event.titleType)}`);
    if (event.keysAvailable !== null) auctions.push(`🔑 ${ru ? "Ключи" : "Ключі"}: ${event.keysAvailable ? ru ? "есть" : "є" : ru ? "нет" : "немає"}`);
    if (event.runAndDrive !== null) auctions.push(`🚗 Run & Drive: ${event.runAndDrive ? ru ? "да" : "так" : ru ? "нет" : "ні"}`);
    if (event.estimatedRetailValue !== null) auctions.push(`💰 Estimated Retail Value: ${formatMoney(event.estimatedRetailValue, event.currency)}`);
    if (event.finalBid !== null) auctions.push(`💵 ${ru ? "Финальная ставка" : "Фінальна ставка"}: ${formatMoney(event.finalBid, event.currency)}`);
    if (event.photos.length) auctions.push(`📸 <a href="${escapeHtml(event.photos[0])}">${ru ? "Открыть первое фото у источника" : "Відкрити перше фото у джерела"}</a> · ${event.photos.length}`);
    if (event.sourceUrl) auctions.push(`🔗 <a href="${escapeHtml(event.sourceUrl)}">${ru ? "Источник" : "Джерело"}</a>`);
  }
  if (history.auctions.length > 1) auctions.push("", ru
    ? "⚠️ Автомобиль найден в нескольких аукционных событиях. Это не означает автоматически несколько ДТП."
    : "⚠️ Автомобіль знайдено в кількох аукціонних подіях. Це не означає автоматично кілька ДТП.");
  sections.push(auctions.join("\n"));

  const marketplace = [`🇺🇦 <b>${ru ? "ИСТОРИЯ ОБЪЯВЛЕНИЙ" : "ІСТОРІЯ ОГОЛОШЕНЬ"}</b>`];
  if (!history.marketplace.length) marketplace.push(ru
    ? "В доступной истории объявлений совпадений не найдено. Это не означает, что автомобиль никогда не продавался."
    : "У доступній історії оголошень збігів не знайдено. Це не означає, що автомобіль ніколи не продавався.");
  for (const listing of history.marketplace) {
    marketplace.push("", `<b>${escapeHtml(listing.provider)}</b>`,
      `${ru ? "Первое обнаружение" : "Перше виявлення"}: ${formatDate(listing.firstSeenAt)}`,
      `${ru ? "Последнее обнаружение" : "Останнє виявлення"}: ${formatDate(listing.lastSeenAt)}`);
    const latest = listing.snapshots.at(-1);
    if (latest?.price !== null && latest?.price !== undefined) marketplace.push(`${ru ? "Цена" : "Ціна"}: ${formatMoney(latest.price, latest.currency)}`);
    if (latest?.mileage !== null && latest?.mileage !== undefined) marketplace.push(`${ru ? "Пробег" : "Пробіг"}: ${formatMileage(latest.mileage, latest.mileageUnit, latest.normalizedMileageKm)}`);
    if (listing.city) marketplace.push(`📍 ${escapeHtml(listing.city)}`);
    marketplace.push(listing.isActive ? (ru ? "Статус: активно" : "Статус: активно") : (ru ? "Статус: объявление снято/больше не обнаруживается источником" : "Статус: оголошення знято/більше не виявляється джерелом"));
    marketplace.push(...priceHistory(listing.snapshots, language));
    if (listing.url) marketplace.push(`🔗 <a href="${escapeHtml(listing.url)}">${ru ? "Оригинальное объявление" : "Оригінальне оголошення"}</a>`);
  }
  if (history.repeatedSalePeriods > 1) marketplace.push("", `🔄 ${ru ? "Автомобиль повторно появлялся в продаже. Известных отдельных объявлений" : "Автомобіль повторно з’являвся у продажу. Відомих окремих оголошень"}: ${history.repeatedSalePeriods}`);
  sections.push(marketplace.join("\n"));

  const mileage = [`📊 <b>${ru ? "ИСТОРИЯ ПРОБЕГА" : "ІСТОРІЯ ПРОБІГУ"}</b>`];
  if (!history.mileage.length) mileage.push(ru ? "Доступных записей пробега нет." : "Доступних записів пробігу немає.");
  for (const point of history.mileage) {
    mileage.push("", `${formatDate(point.date)} · ${escapeHtml(point.source)}`, formatMileage(point.mileage, point.unit, point.normalizedMileageKm));
  }
  for (const warning of history.odometerWarnings) mileage.push("", `🔴 ${ru ? "Обнаружено возможное несоответствие показаний пробега" : "Виявлено можливу невідповідність показань пробігу"}: ${warning.previous.normalizedMileageKm.toLocaleString("uk-UA")} км → ${warning.current.normalizedMileageKm.toLocaleString("uk-UA")} км.`);
  sections.push(mileage.join("\n"));

  const analysis = [`⚠️ <b>${ru ? "АНАЛИТИКА" : "АНАЛІТИКА"}</b>`];
  if (!warningCount) analysis.push(ru ? "В доступных дополнительных данных противоречий не найдено." : "У доступних додаткових даних суперечностей не знайдено.");
  for (const warning of history.crossSourceWarnings) {
    analysis.push("", `⚠️ ${escapeHtml(warning.message)}`);
    for (const [source, value] of Object.entries(warning.sources)) analysis.push(`${escapeHtml(source)}: ${escapeHtml(value)}`);
  }
  if (history.historyScore !== null) {
    analysis.push("", `📈 <b>${ru ? "Аналитический индекс истории" : "Аналітичний індекс історії"}: ${history.historyScore}/100</b>`, ...history.scoreFactors,
      "", ru
        ? "Индекс рассчитан сервисом автоматически на основании доступных данных и не является технической диагностикой автомобиля."
        : "Індекс розрахований сервісом автоматично на підставі доступних даних і не є технічною діагностикою автомобіля.");
  }
  sections.push(analysis.join("\n"));

  const timeline = [`📅 <b>${ru ? "ОБЩАЯ ХРОНОЛОГИЯ" : "ЗАГАЛЬНА ХРОНОЛОГІЯ"}</b>`];
  for (const event of history.timeline.slice(-30)) {
    const details = [event.description, event.mileageKm === null ? null : `${event.mileageKm.toLocaleString("uk-UA")} км`, event.price === null ? null : formatMoney(event.price, event.currency)].filter(Boolean).join(" · ");
    timeline.push("", `${formatDate(event.date)} · ${escapeHtml(event.source)}`, `${escapeHtml(event.title)}${details ? ` · ${escapeHtml(details)}` : ""}`);
  }
  sections.push(timeline.join("\n"));
  return sections.flatMap((section) => splitMessage(section));
}
