import {
  escapeHtml,
  formatDate,
  importedEvent,
  orderedEvents,
  ownerChangeEvents,
  RegionResolver,
  RegistrationOperationFormatter,
} from "./presentation.js";
import type {
  AuctionHistoryEvent,
  CompactEvent,
  FullReportSection,
  Language,
  VehicleCandidate,
  VehicleMatch,
  VehicleReportData,
} from "./types.js";

const TELEGRAM_SAFE_LIMIT = 3_900;

function unknown(language: Language): string {
  return language === "ru" ? "нет данных" : "немає даних";
}

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${Math.round(value).toLocaleString("uk-UA")} ${escapeHtml(currency ?? "")}`.trim();
}

function formatMileage(value: number | null, unit: string | null, km: number | null): string {
  if (value === null) return "—";
  const original = `${Math.round(value).toLocaleString("uk-UA")} ${escapeHtml(unit ?? "")}`.trim();
  return km !== null && !["km", "км"].includes((unit ?? "").toLowerCase())
    ? `${original} ≈ ${km.toLocaleString("uk-UA")} км`
    : original;
}

function externalOverviewStatus(
  label: string,
  status: VehicleReportData["externalHistory"]["auctions"] | undefined,
  count: number,
  language: Language,
): string {
  if (status === "available" && count > 0) {
    return `✅ ${label}: ${language === "ru" ? `найдено ${count}` : `знайдено ${count}`}`;
  }
  if (status === "empty" || (status === "available" && count === 0)) {
    return `⚪ ${label}: ${language === "ru" ? "данных не найдено" : "даних не знайдено"}`;
  }
  if (status === "unavailable") {
    return `⚪ ${label}: ${language === "ru" ? "временно недоступно" : "тимчасово недоступно"}`;
  }
  return `⚪ ${label}: ${language === "ru" ? "источник не подключён" : "джерело не підключено"}`;
}

function title(data: VehicleReportData): string {
  const vehicle = data.match.vehicle;
  return [vehicle.b, vehicle.m].filter(Boolean).map(escapeHtml).join(" ") || "—";
}

function ownerCount(data: VehicleReportData, language: Language): number {
  return ownerChangeEvents(data.match.vehicle.e ?? [], language).length;
}

function plateCount(data: VehicleReportData): number {
  return new Set((data.match.vehicle.e ?? []).map((event) => event[3]).filter(Boolean)).size;
}

function regionValues(data: VehicleReportData, language: Language): string[] {
  return [...new Set((data.match.vehicle.e ?? [])
    .map((event) => RegionResolver.resolve(event[4], language))
    .filter((value): value is string => Boolean(value)))];
}

function latestRegion(data: VehicleReportData, language: Language): string | null {
  for (const event of [...orderedEvents(data.match.vehicle.e ?? [])].reverse()) {
    const region = RegionResolver.resolve(event[4], language);
    if (region) return region;
  }
  return null;
}

function characteristicDifferences(data: VehicleReportData, language: Language): string[] {
  const fields: Array<{ labelRu: string; labelUk: string; index: number; suffix?: string }> = [
    { labelRu: "Цвет", labelUk: "Колір", index: 6 },
    { labelRu: "Топливо", labelUk: "Паливо", index: 7 },
    { labelRu: "Двигатель", labelUk: "Двигун", index: 8, suffix: " см³" },
    { labelRu: "Кузов", labelUk: "Кузов", index: 9 },
    { labelRu: "Назначение", labelUk: "Призначення", index: 10 },
    { labelRu: "Тип ТС", labelUk: "Тип ТЗ", index: 13 },
  ];
  const differences: string[] = [];
  for (const field of fields) {
    const values: string[] = [];
    for (const event of orderedEvents(data.match.vehicle.e ?? [])) {
      const raw = event[field.index];
      if (raw === null || raw === undefined) continue;
      const value = `${raw}${field.suffix ?? ""}`;
      if (values.at(-1) !== value) values.push(value);
    }
    if (new Set(values).size > 1) {
      differences.push(
        `${language === "ru" ? field.labelRu : field.labelUk}: ${values.map(escapeHtml).join(" → ")}`,
      );
    }
  }
  return differences;
}

function calculatedHistoryScore(
  data: VehicleReportData,
  language: Language,
  differenceCount = characteristicDifferences(data, language).length,
): number {
  let score = data.externalHistory?.data?.historyScore ?? 100;
  if (!data.match.vehicle.v) score -= 10;
  if (data.wanted.status === "match") score -= 50;
  score -= Math.min(20, Math.max(0, ownerCount(data, language) - 2) * 5);
  if (differenceCount && data.match.vehicle.v) score -= Math.min(15, differenceCount * 5);
  return Math.max(0, score);
}

function sourceFreshnessLines(data: VehicleReportData, language: Language): string[] {
  const lines: string[] = [];
  if (data.source.coverageThrough) {
    lines.push(
      `📅 ${language === "ru" ? "Данные реестра по" : "Дані реєстру по"}: ${formatDate(data.source.coverageThrough)} ${language === "ru" ? "включительно" : "включно"}`,
    );
  }
  if ((data.source.updateFrequency ?? "monthly") === "monthly") {
    lines.push(`🔄 ${language === "ru" ? "База обновляется раз в месяц" : "База оновлюється раз на місяць"}.`);
  }
  if (data.source.updatedAt) {
    lines.push(
      `🕓 ${language === "ru" ? "Последнее обновление источника" : "Останнє оновлення джерела"}: ${formatDate(data.source.updatedAt)}`,
    );
  }
  return lines;
}

function wantedBrief(data: VehicleReportData, language: Language): string[] {
  const checked = data.wanted.checkedAt ? `\n${language === "ru" ? "Проверено" : "Перевірено"}: ${formatDate(data.wanted.checkedAt)}` : "";
  if (data.wanted.status === "match") {
    return [
      "🚨 <b>" + (language === "ru" ? "Розыск" : "Розшук") + "</b>",
      language === "ru"
        ? `⚠️ Найдено совпадений в подключённом открытом реестре: ${data.wanted.matches.length}. Проверьте первоисточник.${checked}`
        : `⚠️ Знайдено збігів у підключеному відкритому реєстрі: ${data.wanted.matches.length}. Перевірте першоджерело.${checked}`,
    ];
  }
  if (data.wanted.status === "clear") {
    return [
      "🚨 <b>" + (language === "ru" ? "Розыск" : "Розшук") + "</b>",
      (language === "ru"
        ? "✅ Совпадений в подключённом открытом реестре не найдено."
        : "✅ Збігів у підключеному відкритому реєстрі не знайдено.") + checked,
    ];
  }
  return [
    "🚨 <b>" + (language === "ru" ? "Розыск" : "Розшук") + "</b>",
    language === "ru"
      ? "⚪ Статус не удалось проверить; вывод об отсутствии розыска не сделан."
      : "⚪ Статус не вдалося перевірити; висновок про відсутність розшуку не зроблено.",
  ];
}

function operationLines(event: CompactEvent, language: Language, includeOriginal: boolean): string[] {
  const operation = RegistrationOperationFormatter.format(event, language);
  const region = RegionResolver.resolve(event[4], language);
  const lines = [formatDate(event[0]), `${operation.icon} ${escapeHtml(operation.label)}`];
  if (region) lines.push(`📍 ${escapeHtml(region)}`);
  if (includeOriginal && operation.original) {
    lines.push(`${language === "ru" ? "Оригинальная операция МВД" : "Оригінальна операція МВС"}: ${escapeHtml(operation.original)}`);
  }
  return lines;
}

function splitLines(lines: string[], limit = TELEGRAM_SAFE_LIMIT): string[] {
  const result: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (current && candidate.length > limit) {
      result.push(current);
      current = line;
    } else current = candidate;
  }
  if (current) result.push(current);
  return result;
}

function durationLabel(left: string, right: string, language: Language): string {
  const days = Math.max(0, Math.round((Date.parse(right) - Date.parse(left)) / 86_400_000));
  const months = Math.round(days / 30.4375);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return language === "ru" ? `≈ ${years} г. ${rest} мес.` : `≈ ${years} р. ${rest} міс.`;
  }
  return language === "ru" ? `≈ ${months} мес.` : `≈ ${months} міс.`;
}

function vinYear(vin: string, registryYear: number | null): number | null {
  const codes = "ABCDEFGHJKLMNPRSTVWXY123456789";
  const index = codes.indexOf(vin[9] ?? "");
  if (index < 0) return null;
  const candidates = [1980 + index, 2010 + index].filter((year) => year <= new Date().getUTCFullYear() + 2);
  if (registryYear) return candidates.sort((left, right) => Math.abs(left - registryYear) - Math.abs(right - registryYear))[0] ?? null;
  return candidates.at(-1) ?? null;
}

function vinRegion(vin: string, language: Language): string {
  const first = vin[0] ?? "";
  if (/[1-5]/.test(first)) return language === "ru" ? "Северная Америка" : "Північна Америка";
  if (/[J-R]/.test(first)) return language === "ru" ? "Азия" : "Азія";
  if (/[S-Z]/.test(first)) return language === "ru" ? "Европа" : "Європа";
  if (/[6-7]/.test(first)) return language === "ru" ? "Океания" : "Океанія";
  if (/[8-9]/.test(first)) return language === "ru" ? "Южная Америка" : "Південна Америка";
  return language === "ru" ? "не определён" : "не визначено";
}

export class ReportRenderer {
  static renderAuctionPhotoCaption(event: AuctionHistoryEvent, language: Language): string {
    const ru = language === "ru";
    const sold = /sold|продан/i.test(event.saleStatus ?? "");
    const lines = [
      `🇺🇸 <b>${escapeHtml(event.auctionName ?? event.provider)}</b>`,
      event.lotNumber ? `${ru ? "Лот" : "Лот"}: <code>${escapeHtml(event.lotNumber)}</code>` : null,
      event.auctionDate
        ? `${sold ? (ru ? "Дата продажи" : "Дата продажу") : (ru ? "Дата аукциона" : "Дата аукціону")}: ${formatDate(event.auctionDate)}`
        : null,
      event.saleStatus ? `${ru ? "Статус" : "Статус"}: ${escapeHtml(event.saleStatus)}` : null,
      event.primaryDamage ? `💥 ${ru ? "Основное повреждение" : "Основне пошкодження"}: ${escapeHtml(event.primaryDamage)}` : null,
      event.secondaryDamage ? `💥 ${ru ? "Дополнительное" : "Додаткове"}: ${escapeHtml(event.secondaryDamage)}` : null,
      event.odometer !== null ? `📊 ${ru ? "Пробег" : "Пробіг"}: ${formatMileage(event.odometer, event.odometerUnit, event.normalizedOdometerKm)}` : null,
      event.finalBid !== null ? `💵 ${ru ? "Финальная ставка" : "Фінальна ставка"}: ${formatMoney(event.finalBid, event.currency)}` : null,
      event.titleType ? `📄 ${ru ? "Документ" : "Документ"}: ${escapeHtml(event.titleType)}` : null,
      event.keysAvailable !== null ? `🔑 ${ru ? "Ключи" : "Ключі"}: ${event.keysAvailable ? (ru ? "есть" : "є") : (ru ? "нет" : "немає")}` : null,
      event.runAndDrive !== null ? `🚗 Run & Drive: ${event.runAndDrive ? (ru ? "да" : "так") : (ru ? "нет" : "ні")}` : null,
    ].filter((line): line is string => Boolean(line));
    return lines.join("\n").slice(0, 1_000);
  }

  static renderVinConfirmation(match: VehicleMatch, plate: string, language: Language): string {
    const vehicle = match.vehicle;
    const vehicleTitle = [vehicle.b, vehicle.m].filter(Boolean).map(escapeHtml).join(" ") || unknown(language);
    const details = [vehicle.y, vehicle.c, vehicle.f].filter(Boolean).map(escapeHtml).join(" · ");
    return [
      language === "ru"
        ? `🔎 <b>По номеру <code>${escapeHtml(plate)}</code> найден исторический VIN</b>`
        : `🔎 <b>За номером <code>${escapeHtml(plate)}</code> знайдено історичний VIN</b>`,
      "",
      `🚘 <b>${vehicleTitle}</b>`,
      details || unknown(language),
      `🔢 VIN: <code>${escapeHtml(vehicle.v ?? "")}</code>`,
      "",
      language === "ru"
        ? "⚠️ Номера могут переноситься на другие автомобили, а в новых открытых данных МВД связь с актуальным номером может отсутствовать."
        : "⚠️ Номери можуть переноситися на інші автомобілі, а в нових відкритих даних МВС зв’язок з актуальним номером може бути відсутній.",
      "",
      language === "ru"
        ? "Это транспортное средство сейчас актуально для проверки?"
        : "Цей транспортний засіб зараз актуальний для перевірки?",
    ].join("\n");
  }

  static renderCandidateSelector(
    plate: string,
    candidates: VehicleCandidate[],
    language: Language,
  ): string {
    const lines = [
      language === "ru"
        ? `🔎 <b>По номеру <code>${escapeHtml(plate)}</code> найдено несколько автомобилей</b>`
        : `🔎 <b>За номером <code>${escapeHtml(plate)}</code> знайдено кілька автомобілів</b>`,
      language === "ru" ? "\nВыберите автомобиль:" : "\nОберіть автомобіль:",
      language === "ru"
        ? "Первым указано авто с самой поздней известной записью этого номера."
        : "Першим зазначено авто з найпізнішим відомим записом цього номера.",
    ];
    candidates.forEach((candidate, index) => {
      const vehicleTitle = [candidate.brand, candidate.model].filter(Boolean).map(escapeHtml).join(" ") || unknown(language);
      const engine = candidate.engineCapacity ? `${candidate.engineCapacity} см³` : null;
      const details = [candidate.year, candidate.color, candidate.fuel, engine].filter(Boolean).map(escapeHtml).join(" · ");
      lines.push(
        `\n${index + 1}️⃣ <b>${vehicleTitle}</b>`,
        details || unknown(language),
        candidate.vin ? `VIN: <code>${escapeHtml(candidate.vin)}</code>` : (language === "ru" ? "VIN: нет в доступных данных" : "VIN: немає у доступних даних"),
        candidate.lastSeenAt
          ? `${language === "ru" ? "Последняя известная запись этого номера" : "Останній відомий запис цього номера"}: ${formatDate(candidate.lastSeenAt)}`
          : candidate.sourceArchiveYear
            ? `${language === "ru" ? "Дата операции отсутствует; архив источника" : "Дата операції відсутня; архів джерела"}: ${candidate.sourceArchiveYear}`
            : `${language === "ru" ? "Последняя известная запись этого номера" : "Останній відомий запис цього номера"}: —`,
      );
    });
    lines.push(language === "ru"
      ? "\nℹ️ Номер не является постоянным идентификатором автомобиля. Истории кандидатов не объединены."
      : "\nℹ️ Номер не є постійним ідентифікатором автомобіля. Історії кандидатів не об’єднано.");
    return lines.join("\n").slice(0, TELEGRAM_SAFE_LIMIT);
  }

  static renderBasicReport(data: VehicleReportData, language: Language): string {
    const vehicle = data.match.vehicle;
    const events = orderedEvents(vehicle.e ?? []);
    const first = events[0];
    const last = events.at(-1);
    const ownerChanges = ownerCount(data, language);
    const recent = [...events].reverse().slice(0, 3);
    const imported = importedEvent(events, language);
    const lines = [
      `🚘 <b>${title(data)}</b>`,
      "",
      `🔢 VIN: ${vehicle.v ? `<code>${escapeHtml(vehicle.v)}</code>` : (language === "ru" ? "не найден в доступных данных" : "не знайдено у доступних даних")}`,
      `🔖 ${language === "ru" ? "Номер" : "Номер"}: <code>${escapeHtml(vehicle.p || unknown(language))}</code>`,
      "",
      `📅 ${vehicle.y ?? unknown(language)}`,
      `🎨 ${escapeHtml(vehicle.c || unknown(language))}`,
      `⛽ ${escapeHtml(vehicle.f || unknown(language))}`,
      `⚙️ ${vehicle.ec ? `${vehicle.ec} см³` : unknown(language)}`,
      `🚗 ${escapeHtml(vehicle.k || unknown(language))}`,
      `🧩 ${escapeHtml(vehicle.bt || unknown(language))}`,
    ];
    if (imported) lines.push(language === "ru" ? "🌍 Импорт: ввоз из-за границы указан в операции" : "🌍 Імпорт: ввезення з-за кордону зазначене в операції");
    lines.push(
      "\n━━━━━━━━━━━━━━",
      language === "ru" ? "📋 <b>История регистрации</b>" : "📋 <b>Історія реєстрації</b>",
      `${language === "ru" ? "Первая известная запись" : "Перша відома подія"}: ${formatDate(first?.[0])}`,
      `${language === "ru" ? "Последняя операция" : "Остання операція"}: ${formatDate(last?.[0])}`,
      `${language === "ru" ? "Регистрационных событий" : "Реєстраційних подій"}: ${events.length}`,
      `${language === "ru" ? "Известных смен владельца" : "Відомих змін власника"}: ${ownerChanges}`,
    );
    if (recent.length) lines.push(language === "ru" ? "\n<b>Последние операции</b>" : "\n<b>Останні операції</b>");
    for (const event of recent) lines.push("", ...operationLines(event, language, false));
    lines.push(
      "\n━━━━━━━━━━━━━━",
      language === "ru" ? "🛡 <b>ОСАГО</b>" : "🛡 <b>ОСЦПВ</b>",
      language === "ru"
        ? "⚪ Статус не удалось проверить автоматически. Доступна официальная проверка МТСБУ по кнопке."
        : "⚪ Статус не вдалося перевірити автоматично. Доступна офіційна перевірка МТСБУ за кнопкою.",
      "\n━━━━━━━━━━━━━━",
      ...wantedBrief(data, language),
      ...(data.externalHistory?.data?.auctions.length
        ? [`🇺🇸 ${language === "ru" ? "Аукционных событий" : "Аукціонних подій"}: ${data.externalHistory.data.auctions.length}`]
        : []),
      ...(data.externalHistory?.data?.marketplace.length
        ? [`🇺🇦 ${language === "ru" ? "Объявлений AUTO.RIA" : "Оголошень AUTO.RIA"}: ${data.externalHistory.data.marketplace.length}`]
        : []),
      "\n━━━━━━━━━━━━━━",
      language === "ru"
        ? `ℹ️ История основана на доступных открытых данных примерно с ${data.source.historyStartYear} года.`
        : `ℹ️ Історія заснована на доступних відкритих даних приблизно з ${data.source.historyStartYear} року.`,
    );
    if (vehicle.y !== null && vehicle.y < data.source.historyStartYear) {
      lines.push(language === "ru"
        ? "⚠️ Авто старше периода покрытия базы — ранняя история может быть неполной."
        : "⚠️ Авто старше періоду покриття бази — рання історія може бути неповною.");
    }
    lines.push(
      `${language === "ru" ? "Источник" : "Джерело"}: ${escapeHtml(data.source.label)}`,
      ...sourceFreshnessLines(data, language),
    );
    return lines.filter((line, index) => line || lines[index - 1] !== "").join("\n").slice(0, TELEGRAM_SAFE_LIMIT);
  }

  static renderFullReportSummary(
    data: VehicleReportData,
    language: Language,
    showSectionPrompt = true,
  ): string {
    const vehicle = data.match.vehicle;
    const events = orderedEvents(vehicle.e ?? []);
    const firstEvent = events.find((event) => event[0]);
    const imported = importedEvent(events, language);
    const region = latestRegion(data, language);
    const ownershipPeriods = events.length ? ownerCount(data, language) + 1 : 0;
    const auctionCount = data.externalHistory?.data?.auctions.length ?? 0;
    const marketplaceCount = data.externalHistory?.data?.marketplace.length ?? 0;
    const mileageCount = data.externalHistory?.data?.mileage.length ?? 0;
    const lines = [
      "📊 <b>STARCAR · " + (language === "ru" ? "ОТЧЁТ" : "ЗВІТ") + "</b>",
      "━━━━━━━━━━━━━━━━━━",
      `🚘 <b>${title(data)} · ${vehicle.y ?? unknown(language)}</b>`,
      vehicle.p ? `🔖 ${language === "ru" ? "Номер" : "Номер"}: <code>${escapeHtml(vehicle.p)}</code>` : "",
      vehicle.v ? `🔢 VIN: <code>${escapeHtml(vehicle.v)}</code>` : "",
      `\n📌 <b>${language === "ru" ? "КОРОТКО ОБ АВТО" : "КОРОТКО ПРО АВТО"}</b>`,
      `• ${language === "ru" ? "Регистрационных событий" : "Реєстраційних подій"}: ${events.length}`,
      `• ${language === "ru" ? "Периодов владения" : "Періодів володіння"}: ${ownershipPeriods}`,
      `• ${language === "ru" ? "Известных номеров" : "Відомих номерів"}: ${plateCount(data)}`,
      `• ${language === "ru" ? "Первое известное событие" : "Перша відома подія"}: ${formatDate(firstEvent?.[0])}`,
      region ? `• ${language === "ru" ? "Последний известный регион" : "Останній відомий регіон"}: ${escapeHtml(region)}` : "",
      `\n🛡 <b>${language === "ru" ? "ПРОВЕРКИ" : "ПЕРЕВІРКИ"}</b>`,
      data.wanted.status === "clear"
        ? (language === "ru" ? "✅ Розыск: совпадений не найдено" : "✅ Розшук: збігів не знайдено")
        : data.wanted.status === "match"
          ? (language === "ru" ? `🚨 Розыск: найдено совпадений — ${data.wanted.matches.length}` : `🚨 Розшук: знайдено збігів — ${data.wanted.matches.length}`)
          : (language === "ru" ? "⚪ Розыск: проверка недоступна" : "⚪ Розшук: перевірка недоступна"),
      language === "ru" ? "⚪ ОСАГО: проверить на сайте МТСБУ" : "⚪ ОСЦПВ: перевірити на сайті МТСБУ",
      externalOverviewStatus(language === "ru" ? "Аукционы США" : "Аукціони США", data.externalHistory?.auctions, auctionCount, language),
      externalOverviewStatus("AUTO.RIA", data.externalHistory?.marketplace, marketplaceCount, language),
      externalOverviewStatus(language === "ru" ? "Пробег" : "Пробіг", data.externalHistory?.odometer, mileageCount, language),
      imported ? `\n🌍 <b>${language === "ru" ? "ИМПОРТ" : "ІМПОРТ"}</b>` : "",
      imported
        ? `${language === "ru" ? "Первое известное событие с признаком ввоза" : "Перша відома подія з ознакою ввезення"}: ${formatDate(imported[0])}`
        : "",
      `\n📈 <b>${language === "ru" ? "Индекс истории Starcar" : "Індекс історії Starcar"}: ${calculatedHistoryScore(data, language)}/100</b>`,
      language === "ru"
        ? "<i>Информационная оценка, не официальный вывод.</i>"
        : "<i>Інформаційна оцінка, не офіційний висновок.</i>",
      showSectionPrompt ? (language === "ru" ? "\nВыберите раздел 👇" : "\nОберіть розділ 👇") : "",
    ];
    return lines.filter(Boolean).join("\n").slice(0, TELEGRAM_SAFE_LIMIT);
  }

  static renderRegistrationsSection(data: VehicleReportData, language: Language): string[] {
    const events = orderedEvents(data.match.vehicle.e ?? []);
    const lines = [language === "ru" ? "📋 <b>РЕГИСТРАЦИОННАЯ ИСТОРИЯ</b>" : "📋 <b>РЕЄСТРАЦІЙНА ІСТОРІЯ</b>"];
    if (!events.length) lines.push(language === "ru" ? "Событий в доступных данных нет." : "Подій у доступних даних немає.");
    events.forEach((event) => lines.push("", ...operationLines(event, language, true)));
    const regions = regionValues(data, language);
    if (regions.length) {
      lines.push(
        language === "ru" ? "\n📍 <b>Известные регионы регистрации</b>" : "\n📍 <b>Відомі регіони реєстрації</b>",
        ...regions.map((region) => `• ${escapeHtml(region)}`),
      );
    }
    if (events.length >= data.source.maxEventsPerVehicle) {
      lines.push(language === "ru"
        ? `\n⚠️ Индекс хранит до ${data.source.maxEventsPerVehicle} последних событий автомобиля.`
        : `\n⚠️ Індекс зберігає до ${data.source.maxEventsPerVehicle} останніх подій автомобіля.`);
    }
    return splitLines(lines);
  }

  static renderOwnershipSection(data: VehicleReportData, language: Language): string[] {
    const events = orderedEvents(data.match.vehicle.e ?? []);
    const changes = ownerChangeEvents(events, language);
    const firstDate = events.find((event) => event[0])?.[0] ?? null;
    const dates = [firstDate, ...changes.map((event) => event[0])].filter((value): value is string => Boolean(value));
    const lines = [
      language === "ru" ? "👥 <b>ИСТОРИЯ ВЛАДЕНИЯ</b>" : "👥 <b>ІСТОРІЯ ВОЛОДІННЯ</b>",
      `${language === "ru" ? "Известных смен владельца в доступной истории" : "Відомих змін власника у доступній історії"}: ${changes.length}`,
    ];
    if (dates.length > 1) lines.push(language === "ru" ? "\n<b>Известные периоды</b>" : "\n<b>Відомі періоди</b>");
    for (let index = 0; index + 1 < dates.length; index += 1) {
      const left = dates[index];
      const right = dates[index + 1];
      if (left && right) lines.push(`\n${formatDate(left)} → ${formatDate(right)}\n${durationLabel(left, right, language)}`);
    }
    lines.push(language === "ru"
      ? "\nℹ️ Это интервалы между известными событиями, а не доказанные точные сроки фактического владения."
      : "\nℹ️ Це інтервали між відомими подіями, а не доведені точні строки фактичного володіння.");
    if (data.match.vehicle.y !== null && data.match.vehicle.y < data.source.historyStartYear) {
      lines.push(language === "ru" ? "⚠️ Реальное число предыдущих владельцев может быть больше." : "⚠️ Реальна кількість попередніх власників може бути більшою.");
    }
    return splitLines(lines);
  }

  static renderVehiclePlatesSection(data: VehicleReportData, language: Language): string[] {
    const events = orderedEvents(data.match.vehicle.e ?? []).filter((event) => event[3]);
    const groups = new Map<string, string[]>();
    for (const event of events) {
      const plate = event[3];
      if (plate && event[0]) groups.set(plate, [...(groups.get(plate) ?? []), event[0]]);
    }
    const lines = [language === "ru" ? "🔖 <b>НОМЕРА АВТОМОБИЛЯ</b>" : "🔖 <b>НОМЕРИ АВТОМОБІЛЯ</b>"];
    for (const [plate, dates] of groups) {
      dates.sort();
      lines.push(`\n<code>${escapeHtml(plate)}</code>`, `${language === "ru" ? "Первое известное появление" : "Перша відома поява"}: ${formatDate(dates[0])}`, `${language === "ru" ? "Последнее известное появление" : "Остання відома поява"}: ${formatDate(dates.at(-1))}`);
    }
    if (!groups.size) lines.push(language === "ru" ? "Номера в доступных событиях отсутствуют." : "Номери у доступних подіях відсутні.");
    return splitLines(lines);
  }

  static renderVinSection(data: VehicleReportData, language: Language): string[] {
    const vehicle = data.match.vehicle;
    if (!vehicle.v) return [language === "ru"
      ? "🔢 <b>АНАЛИЗ VIN</b>\n\nVIN отсутствует в доступной записи источника. Это не означает, что у автомобиля физически нет VIN."
      : "🔢 <b>АНАЛІЗ VIN</b>\n\nVIN відсутній у доступному записі джерела. Це не означає, що автомобіль фізично не має VIN."];
    const valid = /^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.v);
    const lines = [
      language === "ru" ? "🔢 <b>АНАЛИЗ VIN</b>" : "🔢 <b>АНАЛІЗ VIN</b>",
      `VIN: <code>${escapeHtml(vehicle.v)}</code>`,
      `WMI: <code>${escapeHtml(vehicle.v.slice(0, 3))}</code>`,
      `${language === "ru" ? "Регион производителя" : "Регіон виробника"}: ${vinRegion(vehicle.v, language)}`,
      `${language === "ru" ? "Модельный год по коду VIN" : "Модельний рік за кодом VIN"}: ${vinYear(vehicle.v, vehicle.y) ?? unknown(language)}`,
      `${language === "ru" ? "Код завода" : "Код заводу"}: <code>${escapeHtml(vehicle.v[10] ?? "—")}</code>`,
      `VIS: <code>${escapeHtml(vehicle.v.slice(9))}</code>`,
      valid
        ? (language === "ru" ? "✅ Структура содержит 17 допустимых символов." : "✅ Структура містить 17 допустимих символів.")
        : (language === "ru" ? "⚠️ Структура не соответствует стандартному формату." : "⚠️ Структура не відповідає стандартному формату."),
      language === "ru"
        ? "ℹ️ Для европейских VIN несовпадение контрольной цифры само по себе не доказывает подделку."
        : "ℹ️ Для європейських VIN розбіжність контрольної цифри сама по собі не доводить підробку.",
    ];
    return splitLines(lines);
  }

  static renderImportSection(data: VehicleReportData, language: Language): string[] {
    const event = importedEvent(data.match.vehicle.e ?? [], language);
    const lines = [language === "ru" ? "🌍 <b>ИМПОРТ</b>" : "🌍 <b>ІМПОРТ</b>"];
    if (!event) lines.push(language === "ru"
      ? "В доступных операциях явный признак ввоза не найден. Это не исключает импорт."
      : "У доступних операціях явної ознаки ввезення не знайдено. Це не виключає імпорт.");
    else lines.push(
      language === "ru" ? "✅ В операции обнаружен признак ввоза из-за границы." : "✅ В операції виявлено ознаку ввезення з-за кордону.",
      `${language === "ru" ? "Первое известное событие с признаком импорта" : "Перша відома подія з ознакою імпорту"}: ${formatDate(event[0])}`,
      ...operationLines(event, language, true).slice(1),
    );
    return splitLines(lines);
  }

  static renderInsuranceSection(data: VehicleReportData, language: Language): string[] {
    return [language === "ru"
      ? "🛡 <b>ОСАГО</b>\n\n⚪ Статус не удалось проверить автоматически. Starcar не выдаёт техническую недоступность за отсутствие полиса. Используйте официальную форму МТСБУ по кнопке."
      : "🛡 <b>ОСЦПВ</b>\n\n⚪ Статус не вдалося перевірити автоматично. Starcar не видає технічну недоступність за відсутність поліса. Скористайтеся офіційною формою МТСБУ за кнопкою."];
  }

  static renderExternalSection(data: VehicleReportData, section: "auctions" | "marketplace" | "odometer", language: Language): string[] {
    const ru = language === "ru";
    const history = data.externalHistory?.data;
    const lines: string[] = [];
    if (section === "auctions") {
      lines.push(ru ? "🇺🇸 <b>АУКЦИОНЫ США</b>" : "🇺🇸 <b>АУКЦІОНИ США</b>");
      if (data.externalHistory?.auctions === "not_connected") lines.push(ru ? "⚪ API аукционной истории ещё не настроен." : "⚪ API аукціонної історії ще не налаштовано.");
      else if (data.externalHistory?.auctions === "unavailable") lines.push(ru ? "⚪ API аукционов временно недоступен." : "⚪ API аукціонів тимчасово недоступний.");
      else if (!history?.auctions.length) lines.push(ru ? "В подключённом источнике совпадений нет. Это не доказывает отсутствие аукционной истории." : "У підключеному джерелі збігів немає. Це не доводить відсутність аукціонної історії.");
      for (const [index, event] of (history?.auctions ?? []).slice(0, 10).entries()) {
        lines.push("", `${index + 1}. <b>${escapeHtml(event.auctionName ?? event.provider)}</b>`);
        if (event.auctionDate) lines.push(`${ru ? "Дата" : "Дата"}: ${formatDate(event.auctionDate)}`);
        if (event.lotNumber) lines.push(`${ru ? "Лот" : "Лот"}: <code>${escapeHtml(event.lotNumber)}</code>`);
        if (event.location) lines.push(`📍 ${escapeHtml(event.location)}`);
        if (event.primaryDamage) lines.push(`💥 ${ru ? "Повреждение" : "Пошкодження"}: ${escapeHtml(event.primaryDamage)}`);
        if (event.odometer !== null) lines.push(`📊 ${formatMileage(event.odometer, event.odometerUnit, event.normalizedOdometerKm)}`);
        if (event.finalBid !== null) lines.push(`💵 ${ru ? "Финальная ставка" : "Фінальна ставка"}: ${formatMoney(event.finalBid, event.currency)}`);
        if (event.photos[0]) lines.push(`📸 <a href="${escapeHtml(event.photos[0])}">${ru ? "Фото источника" : "Фото джерела"}</a>`);
        if (event.sourceUrl) lines.push(`🔗 <a href="${escapeHtml(event.sourceUrl)}">${ru ? "Карточка лота" : "Картка лота"}</a>`);
      }
      if (data.match.vehicle.v) lines.push("", ru
        ? "🔎 Дополнительный поиск точного VIN доступен по кнопкам PLC.ua, все аукционы, Copart и BidFax. Результаты Google не являются подтверждённым совпадением Starcar."
        : "🔎 Додатковий пошук точного VIN доступний за кнопками PLC.ua, усі аукціони, Copart і BidFax. Результати Google не є підтвердженим збігом Starcar.");
    } else if (section === "marketplace") {
      lines.push(ru ? "🇺🇦 <b>ИСТОРИЯ ОБЪЯВЛЕНИЙ AUTO.RIA</b>" : "🇺🇦 <b>ІСТОРІЯ ОГОЛОШЕНЬ AUTO.RIA</b>");
      if (data.externalHistory?.marketplace === "not_connected") lines.push(ru ? "⚪ API AUTO.RIA ещё не настроен." : "⚪ API AUTO.RIA ще не налаштовано.");
      else if (data.externalHistory?.marketplace === "unavailable") lines.push(ru ? "⚪ AUTO.RIA временно недоступен." : "⚪ AUTO.RIA тимчасово недоступний.");
      else if (!history?.marketplace.length) lines.push(ru ? "В доступной истории объявлений совпадений нет. Это не означает, что авто никогда не продавалось." : "У доступній історії оголошень збігів немає. Це не означає, що авто ніколи не продавалося.");
      for (const listing of (history?.marketplace ?? []).slice(0, 10)) {
        const latest = listing.snapshots.at(-1);
        const listingTitle = listing.title ?? (`${listing.brand ?? ""} ${listing.model ?? ""}`.trim() || listing.provider);
        lines.push("", `<b>${escapeHtml(listingTitle)}</b>`, `${ru ? "Первое обнаружение" : "Перше виявлення"}: ${formatDate(listing.firstSeenAt)}`, `${ru ? "Последнее" : "Останнє"}: ${formatDate(listing.lastSeenAt)}`);
        if (latest?.price !== null && latest?.price !== undefined) lines.push(`💰 ${formatMoney(latest.price, latest.currency)}`);
        if (latest?.mileage !== null && latest?.mileage !== undefined) lines.push(`📊 ${formatMileage(latest.mileage, latest.mileageUnit, latest.normalizedMileageKm)}`);
        if (listing.url) lines.push(`🔗 <a href="${escapeHtml(listing.url)}">${ru ? "Открыть объявление" : "Відкрити оголошення"}</a>`);
      }
    } else {
      lines.push(ru ? "📊 <b>ИСТОРИЯ ПРОБЕГА</b>" : "📊 <b>ІСТОРІЯ ПРОБІГУ</b>");
      if (!history?.mileage.length) lines.push(ru ? "Доступных записей пробега нет. Starcar не делает вывод без источника." : "Доступних записів пробігу немає. Starcar не робить висновок без джерела.");
      for (const point of history?.mileage ?? []) lines.push("", `${formatDate(point.date)} · ${escapeHtml(point.source)}`, formatMileage(point.mileage, point.unit, point.normalizedMileageKm));
      for (const warning of history?.odometerWarnings ?? []) lines.push("", `🔴 ${ru ? "Возможное снижение показаний" : "Можливе зниження показань"}: ${warning.previous.normalizedMileageKm.toLocaleString("uk-UA")} км → ${warning.current.normalizedMileageKm.toLocaleString("uk-UA")} км`);
    }
    return splitLines(lines);
  }

  static renderAnalyticsSection(data: VehicleReportData, language: Language): string[] {
    const vehicle = data.match.vehicle;
    const differences = characteristicDifferences(data, language);
    const lines = [language === "ru" ? "⚠️ <b>АНАЛИТИКА</b>" : "⚠️ <b>АНАЛІТИКА</b>"];
    if (differences.length && vehicle.v) {
      lines.push(language === "ru" ? "Различия внутри событий одного VIN:" : "Відмінності всередині подій одного VIN:", ...differences);
    } else if (differences.length) {
      lines.push(language === "ru"
        ? "⚠️ В доступных данных обнаружено различие характеристик, но из-за отсутствия VIN невозможно подтвердить, что записи относятся к одному автомобилю. Изменения не показаны как факт."
        : "⚠️ У доступних даних виявлено відмінність характеристик, але через відсутність VIN неможливо підтвердити, що записи належать одному автомобілю. Зміни не показані як факт.");
    } else lines.push(language === "ru" ? "Подтверждённых изменений характеристик не найдено." : "Підтверджених змін характеристик не знайдено.");
    for (const warning of data.externalHistory?.data?.crossSourceWarnings ?? []) {
      lines.push("", `⚠️ ${escapeHtml(warning.message)}`);
      for (const [source, value] of Object.entries(warning.sources)) {
        lines.push(`${escapeHtml(source)}: ${escapeHtml(value)}`);
      }
    }
    if (data.externalHistory?.data?.odometerWarnings.length) {
      lines.push("", language === "ru" ? "🔴 Обнаружены возможные несоответствия пробега." : "🔴 Виявлено можливі невідповідності пробігу.");
    }
    const score = calculatedHistoryScore(data, language, differences.length);
    lines.push(
      `\n📈 <b>${language === "ru" ? "Аналитический индекс истории" : "Аналітичний індекс історії"}: ${score}/100</b>`,
      language === "ru"
        ? "Индекс является автоматической аналитикой Starcar и не является техническим заключением."
        : "Індекс є автоматичною аналітикою Starcar і не є технічним висновком.",
    );
    for (const factor of data.externalHistory?.data?.scoreFactors ?? []) lines.push(`• ${escapeHtml(factor)}`);
    return splitLines(lines);
  }

  static renderTimelineSection(data: VehicleReportData, language: Language): string[] {
    const lines = [language === "ru" ? "📅 <b>ОБЩАЯ ХРОНОЛОГИЯ</b>" : "📅 <b>ЗАГАЛЬНА ХРОНОЛОГІЯ</b>"];
    for (const event of orderedEvents(data.match.vehicle.e ?? [])) {
      const operation = RegistrationOperationFormatter.format(event, language);
      lines.push(`\n${formatDate(event[0])} · 🇺🇦\n${operation.icon} ${escapeHtml(operation.label)}`);
    }
    for (const event of (data.externalHistory?.data?.timeline ?? []).filter((item) => item.type !== "registration")) {
      const details = [event.description, event.mileageKm === null ? null : `${event.mileageKm.toLocaleString("uk-UA")} км`, event.price === null ? null : formatMoney(event.price, event.currency)].filter(Boolean).join(" · ");
      lines.push(`\n${formatDate(event.date)} · ${escapeHtml(event.source)}\n${escapeHtml(event.title)}${details ? ` · ${escapeHtml(details)}` : ""}`);
    }
    if (!(data.externalHistory?.data?.timeline ?? []).some((item) => item.type !== "registration")) lines.push(language === "ru"
      ? "\nВнешних аукционных или рекламных событий в доступных источниках нет."
      : "\nЗовнішніх аукціонних або рекламних подій у доступних джерелах немає.");
    return splitLines(lines);
  }

  static renderSourcesSection(data: VehicleReportData, language: Language): string[] {
    return [[
      language === "ru" ? "ℹ️ <b>ИСТОЧНИКИ И ПОЛНОТА ДАННЫХ</b>" : "ℹ️ <b>ДЖЕРЕЛА ТА ПОВНОТА ДАНИХ</b>",
      `\n<a href="${escapeHtml(data.source.url)}">${escapeHtml(data.source.label)}</a>`,
      ...sourceFreshnessLines(data, language),
      `\n${language === "ru"
        ? `Starcar формирует историю по подключённым источникам. Доступная регистрационная история содержит данные примерно с ${data.source.historyStartYear} года. Ранние события, номера и смены владельцев могут отсутствовать.`
        : `Starcar формує історію за підключеними джерелами. Доступна реєстраційна історія містить дані приблизно з ${data.source.historyStartYear} року. Ранні події, номери та зміни власників можуть бути відсутні.`}`,
      `\n<a href="${escapeHtml(data.wanted.sourceUrl ?? "https://data.gov.ua")}">${language === "ru" ? "Открытый реестр розыска Национальной полиции" : "Відкритий реєстр розшуку Національної поліції"}</a>`,
      `<a href="${escapeHtml(data.insurance.checkUrl)}">${language === "ru" ? "Официальная проверка ОСАГО МТСБУ" : "Офіційна перевірка ОСЦПВ МТСБУ"}</a>`,
      `<a href="https://auto.ria.com/uk/">AUTO.RIA</a>`,
      `<a href="https://apibara.tech/">${language === "ru" ? "API истории Copart/IAAI" : "API історії Copart/IAAI"}</a>`,
      `<a href="${escapeHtml(data.externalHistory?.bidfaxUrl ?? "https://bidfax.co/")}">BidFax</a>`,
    ].join("\n")];
  }

  static renderSection(data: VehicleReportData, section: FullReportSection, language: Language): string[] {
    switch (section) {
      case "registrations": return this.renderRegistrationsSection(data, language);
      case "ownership": return this.renderOwnershipSection(data, language);
      case "plates": return this.renderVehiclePlatesSection(data, language);
      case "vin": return this.renderVinSection(data, language);
      case "import": return this.renderImportSection(data, language);
      case "insurance": return this.renderInsuranceSection(data, language);
      case "auctions": return this.renderExternalSection(data, "auctions", language);
      case "marketplace": return this.renderExternalSection(data, "marketplace", language);
      case "odometer": return this.renderExternalSection(data, "odometer", language);
      case "analytics": return this.renderAnalyticsSection(data, language);
      case "timeline": return this.renderTimelineSection(data, language);
      case "sources": return this.renderSourcesSection(data, language);
    }
  }

  static renderAll(data: VehicleReportData, language: Language): string[] {
    const external = data.externalHistory?.data;
    const blocks = [
      this.renderFullReportSummary(data, language, false),
      ...this.renderRegistrationsSection(data, language),
      ...this.renderOwnershipSection(data, language),
      ...this.renderVehiclePlatesSection(data, language),
      ...this.renderVinSection(data, language),
      ...this.renderImportSection(data, language),
      ...(external?.auctions.length ? this.renderExternalSection(data, "auctions", language) : []),
      ...(external?.marketplace.length ? this.renderExternalSection(data, "marketplace", language) : []),
      ...(external?.mileage.length ? this.renderExternalSection(data, "odometer", language) : []),
      ...this.renderAnalyticsSection(data, language),
      ...this.renderTimelineSection(data, language),
      ...this.renderSourcesSection(data, language),
    ];
    const parts = splitLines(blocks.flatMap((block) => ["", block]));
    if (parts.length <= 3) return parts;
    const third = parts.slice(2).join("\n\n");
    return [parts[0] ?? "", parts[1] ?? "", `${third.slice(0, TELEGRAM_SAFE_LIMIT - 160)}\n\n${language === "ru" ? "…Остальные сведения доступны через кнопки разделов." : "…Решта відомостей доступна через кнопки розділів."}`];
  }
}
