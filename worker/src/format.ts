import type { CompactEvent, IndexManifest, Language, VehicleMatch } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function latestEvent(events: CompactEvent[]): CompactEvent | undefined {
  return [...events].sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")).at(-1);
}

export function renderVehicle(
  match: VehicleMatch,
  manifest: IndexManifest,
  language: Language,
  configuredHistoryStartYear = 2013,
): string {
  const vehicle = match.vehicle;
  const unknown = language === "ru" ? "нет данных" : "немає даних";
  const events = vehicle.e ?? [];
  const ordered = [...events].sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
  const first = ordered[0];
  const last = latestEvent(ordered);
  const regions = [...new Set(ordered.map((event) => event[4]).filter(Boolean))] as string[];
  const title = [vehicle.b, vehicle.m].filter(Boolean).map(escapeHtml).join(" ") || unknown;
  const lines = [`🚘 <b>${title}</b>`];
  if (match.candidates > 1) {
    lines.push(language === "ru" ? `\n⚠️ Возможных совпадений: ${match.candidates}` : `\n⚠️ Можливих збігів: ${match.candidates}`);
  }
  const coverage = manifest.data_coverage_through
    ? formatDate(manifest.data_coverage_through)
    : null;
  if (coverage) {
    lines.push(
      `📅 ${language === "ru" ? "Данные реестра по" : "Дані реєстру по"}: ${coverage} ${language === "ru" ? "включительно" : "включно"}`,
    );
  }
  if ((manifest.update_frequency ?? "monthly") === "monthly") {
    lines.push(`🔄 ${language === "ru" ? "База обновляется раз в месяц" : "База оновлюється раз на місяць"}.`);
  }
  lines.push(
    `\n🔢 VIN: <code>${escapeHtml(vehicle.v || unknown)}</code>`,
    `🔖 ${language === "ru" ? "Номер" : "Номер"}: <code>${escapeHtml(vehicle.p || unknown)}</code>`,
    `📅 ${language === "ru" ? "Год" : "Рік"}: ${vehicle.y ?? unknown}`,
    `🎨 ${language === "ru" ? "Цвет" : "Колір"}: ${escapeHtml(vehicle.c || unknown)}`,
    `⛽ ${language === "ru" ? "Топливо" : "Паливо"}: ${escapeHtml(vehicle.f || unknown)}`,
    `⚙️ ${language === "ru" ? "Двигатель" : "Двигун"}: ${vehicle.ec ? `${vehicle.ec} см³` : unknown}`,
    `🚗 ${language === "ru" ? "Тип" : "Тип"}: ${escapeHtml(vehicle.k || unknown)}`,
    `🧩 ${language === "ru" ? "Кузов" : "Кузов"}: ${escapeHtml(vehicle.bt || unknown)}`,
    `\n📋 ${language === "ru" ? "Регистрационных событий" : "Реєстраційних подій"}: ${events.length}`,
    `${language === "ru" ? "Первое известное событие" : "Перша відома подія"}: ${formatDate(first?.[0] ?? null) || unknown}`,
    `${language === "ru" ? "Последняя операция" : "Остання операція"}: ${formatDate(last?.[0] ?? null) || unknown}`,
    `📍 ${language === "ru" ? "Последний известный регион" : "Останній відомий регіон"}: ${escapeHtml(regions.at(-1) || unknown)}`,
  );
  const history = ordered.slice(-10);
  if (history.length) {
    lines.push(language === "ru" ? "\n📋 <b>Последние операции</b>" : "\n📋 <b>Останні операції</b>");
    for (const event of history) {
      const details = event[2] || event[1] || unknown;
      const plate = event[3] ? ` · ${escapeHtml(event[3])}` : "";
      const region = event[4] ? ` · ${escapeHtml(event[4])}` : "";
      lines.push(`\n${formatDate(event[0]) || unknown}${plate}${region}\n${escapeHtml(details)}`);
    }
  }
  const freshness = manifest.dataset_updated_at ? formatDate(manifest.dataset_updated_at.slice(0, 10)) : null;
  const historyStartYear = manifest.history_start_year ?? configuredHistoryStartYear;
  lines.push(
    language === "ru" ? "\nℹ️ <b>Полнота истории</b>" : "\nℹ️ <b>Повнота історії</b>",
    language === "ru"
      ? `Доступная регистрационная история сформирована по подключённым источникам, содержащим данные примерно с ${historyStartYear} года, и может быть неполной.`
      : `Доступна реєстраційна історія сформована за підключеними джерелами, що містять дані приблизно з ${historyStartYear} року, і може бути неповною.`,
  );
  if (vehicle.y !== null && vehicle.y < historyStartYear) {
    lines.push(
      language === "ru"
        ? `⚠️ <b>Автомобиль старше периода покрытия базы</b>\nАвтомобиль выпущен в ${vehicle.y} году. Более ранние события и владельцы могут отсутствовать; реальное число владельцев может быть больше.`
        : `⚠️ <b>Автомобіль старший за період покриття бази</b>\nАвтомобіль випущений у ${vehicle.y} році. Ранніші події та власники можуть бути відсутні; реальна кількість власників може бути більшою.`,
    );
  } else if (vehicle.y === null) {
    lines.push(
      language === "ru"
        ? "Год автомобиля неизвестен; по нему нельзя определить, старше ли автомобиль периода покрытия."
        : "Рік автомобіля невідомий; за ним не можна визначити, чи автомобіль старший за період покриття.",
    );
  }
  lines.push(
    language === "ru"
      ? "Отсутствие старого события не означает отсутствие регистрации или владельца."
      : "Відсутність старої події не означає відсутність реєстрації або власника.",
  );
  lines.push(`\n${language === "ru" ? "Источник" : "Джерело"}: <a href="${escapeHtml(manifest.source_url)}">${escapeHtml(manifest.source_label)}</a>`);
  if (freshness) lines.push(`🕓 ${language === "ru" ? "Последнее обновление источника" : "Останнє оновлення джерела"}: ${freshness}`);
  return lines.join("\n").slice(0, 4096);
}
