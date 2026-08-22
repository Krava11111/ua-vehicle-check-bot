import type { CompactEvent, Language, VehicleMatch, WantedCheck } from "./types.js";

const DAY_MS = 86_400_000;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

interface WmiInfo {
  manufacturer: string;
  country: string;
}

const WMI: Record<string, WmiInfo> = {
  WVW: { manufacturer: "Volkswagen", country: "Німеччина / Германия" },
  WV1: { manufacturer: "Volkswagen Commercial Vehicles", country: "Німеччина / Германия" },
  WV2: { manufacturer: "Volkswagen Commercial Vehicles", country: "Німеччина / Германия" },
  WVG: { manufacturer: "Volkswagen", country: "Німеччина / Германия" },
  WAU: { manufacturer: "Audi", country: "Німеччина / Германия" },
  WBA: { manufacturer: "BMW", country: "Німеччина / Германия" },
  WBS: { manufacturer: "BMW M", country: "Німеччина / Германия" },
  WBY: { manufacturer: "BMW", country: "Німеччина / Германия" },
  WDB: { manufacturer: "Mercedes-Benz", country: "Німеччина / Германия" },
  WDD: { manufacturer: "Mercedes-Benz", country: "Німеччина / Германия" },
  WDC: { manufacturer: "Mercedes-Benz", country: "Німеччина / Германия" },
  W1K: { manufacturer: "Mercedes-Benz", country: "Німеччина / Германия" },
  W1N: { manufacturer: "Mercedes-Benz", country: "Німеччина / Германия" },
  W0L: { manufacturer: "Opel", country: "Німеччина / Германия" },
  WF0: { manufacturer: "Ford", country: "Німеччина / Германия" },
  VF1: { manufacturer: "Renault", country: "Франція / Франция" },
  VF3: { manufacturer: "Peugeot", country: "Франція / Франция" },
  VF7: { manufacturer: "Citroën", country: "Франція / Франция" },
  VR1: { manufacturer: "Peugeot", country: "Франція / Франция" },
  VSS: { manufacturer: "SEAT", country: "Іспанія / Испания" },
  TMB: { manufacturer: "Škoda", country: "Чехія / Чехия" },
  TMA: { manufacturer: "Hyundai", country: "Чехія / Чехия" },
  ZFA: { manufacturer: "Fiat", country: "Італія / Италия" },
  ZAR: { manufacturer: "Alfa Romeo", country: "Італія / Италия" },
  ZFF: { manufacturer: "Ferrari", country: "Італія / Италия" },
  SAL: { manufacturer: "Land Rover", country: "Велика Британія / Великобритания" },
  SAJ: { manufacturer: "Jaguar", country: "Велика Британія / Великобритания" },
  SJN: { manufacturer: "Nissan", country: "Велика Британія / Великобритания" },
  YV1: { manufacturer: "Volvo", country: "Швеція / Швеция" },
  YS3: { manufacturer: "Saab", country: "Швеція / Швеция" },
  Y6D: { manufacturer: "ЗАЗ / Daewoo", country: "Україна / Украина" },
  XTA: { manufacturer: "Lada / ВАЗ", country: "Росія / Россия" },
  XTC: { manufacturer: "КамАЗ", country: "Росія / Россия" },
  XTT: { manufacturer: "УАЗ", country: "Росія / Россия" },
  KMH: { manufacturer: "Hyundai", country: "Південна Корея / Южная Корея" },
  KNA: { manufacturer: "Kia", country: "Південна Корея / Южная Корея" },
  KNE: { manufacturer: "Kia", country: "Південна Корея / Южная Корея" },
  KL1: { manufacturer: "Chevrolet / GM Daewoo", country: "Південна Корея / Южная Корея" },
  JHM: { manufacturer: "Honda", country: "Японія / Япония" },
  JTD: { manufacturer: "Toyota", country: "Японія / Япония" },
  JN1: { manufacturer: "Nissan", country: "Японія / Япония" },
  JMZ: { manufacturer: "Mazda", country: "Японія / Япония" },
  JSA: { manufacturer: "Suzuki", country: "Японія / Япония" },
  "1HG": { manufacturer: "Honda", country: "США" },
  "1FA": { manufacturer: "Ford", country: "США" },
  "1FM": { manufacturer: "Ford", country: "США" },
  "1VW": { manufacturer: "Volkswagen", country: "США" },
  "2HG": { manufacturer: "Honda", country: "Канада" },
};

const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  const parts = value?.slice(0, 10).split("-") ?? [];
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value ?? "—";
}

function formatDuration(days: number, language: Language): string {
  const months = Math.max(0, Math.floor(days / 30.4375));
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const chunks: string[] = [];
  if (years) chunks.push(language === "ru" ? `${years} г.` : `${years} р.`);
  if (rest || !years) chunks.push(language === "ru" ? `${rest} мес.` : `${rest} міс.`);
  return chunks.join(" ");
}

function daysBetween(left: Date, right: Date): number {
  return Math.max(0, Math.round((right.getTime() - left.getTime()) / DAY_MS));
}

function orderedEvents(events: CompactEvent[]): CompactEvent[] {
  return [...events].sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
}

function vinRegion(first: string, language: Language): string {
  if (/[1-5]/.test(first)) return language === "ru" ? "Северная Америка" : "Північна Америка";
  if (/[A-H]/.test(first)) return language === "ru" ? "Африка" : "Африка";
  if (/[J-R]/.test(first)) return language === "ru" ? "Азия" : "Азія";
  if (/[S-Z]/.test(first)) return language === "ru" ? "Европа" : "Європа";
  if (/[6-7]/.test(first)) return language === "ru" ? "Океания" : "Океанія";
  if (/[8-9]/.test(first)) return language === "ru" ? "Южная Америка" : "Південна Америка";
  return language === "ru" ? "не определён" : "не визначено";
}

function modelYear(vin: string, registryYear: number | null): number | null {
  const index = VIN_YEAR_CODES.indexOf(vin[9] ?? "");
  if (index < 0) return null;
  const base = 1980 + index;
  const candidates = [base, base + 30].filter((year) => year <= new Date().getUTCFullYear() + 2);
  if (!candidates.length) return null;
  if (registryYear) return candidates.sort((a, b) => Math.abs(a - registryYear) - Math.abs(b - registryYear))[0] ?? null;
  return candidates.at(-1) ?? null;
}

function checkDigit(vin: string): { expected: string; matches: boolean } | null {
  if (!/[1-5]/.test(vin[0] ?? "")) return null;
  let sum = 0;
  for (let index = 0; index < vin.length; index += 1) {
    const char = vin[index];
    const weight = VIN_WEIGHTS[index];
    if (!char || weight === undefined) return null;
    const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return null;
    sum += value * weight;
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return { expected, matches: vin[8] === expected };
}

function normalizedBrand(value: string): string {
  return value.toUpperCase().replaceAll("Ë", "E").replaceAll("Š", "S").replaceAll("Ö", "O").replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
}

function brandMatches(manufacturer: string, registryBrand: string | null): boolean {
  if (!registryBrand) return true;
  const maker = normalizedBrand(manufacturer.split("/")[0] ?? manufacturer);
  const registry = normalizedBrand(registryBrand);
  if (maker.includes("MERCEDES")) return registry.includes("MERCEDES");
  if (maker.includes("VOLKSWAGEN")) return registry.includes("VOLKSWAGEN") || registry === "VW";
  if (maker.includes("LADA")) return registry.includes("LADA") || registry.includes("ВАЗ");
  if (maker.includes("CHEVROLET")) return registry.includes("CHEVROLET") || registry.includes("DAEWOO");
  return registry.includes(maker) || maker.includes(registry);
}

function isOwnerChange(operation: string | null | undefined): boolean {
  const text = operation?.toUpperCase() ?? "";
  if (/ЗМІН[АИ].*ВЛАСНИК|НОВ.*ВЛАСНИК|СПАДЩ|УСПАДК|ДАРУВ|КУПІВЛ|ПРОДАЖ|ВІДЧУЖ|ДОГОВ/.test(text)) return true;
  return /ПЕРЕРЕЄСТРАЦ/.test(text) && !/НОМЕР|ДОКУМЕНТ|ПЕРЕОБЛАДН|КОЛЬОР|АГРЕГАТ/.test(text);
}

function isImported(operation: string | null | undefined): boolean {
  return /ВВЕЗ|ІМПОРТ|МИТН/.test(operation?.toUpperCase() ?? "");
}

function fitLines(lines: string[], max = 3_900): string {
  const accepted: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > max) {
      accepted.push("…");
      break;
    }
    accepted.push(line);
    length += line.length + 1;
  }
  return accepted.join("\n");
}

function wantedLines(check: WantedCheck, language: Language): string[] {
  const lines = ["🚨 <b>" + (language === "ru" ? "Розыск" : "Розшук") + "</b>"];
  if (check.status === "match") {
    lines.push(language === "ru"
      ? `⚠️ Найдено совпадений в открытом реестре: ${check.matches.length}. Требуется проверка по первоисточнику.`
      : `⚠️ Знайдено збігів у відкритому реєстрі: ${check.matches.length}. Потрібна перевірка за першоджерелом.`);
    for (const record of check.matches.slice(0, 3)) {
      const identity = [record[4], record[5]].filter(Boolean).join(" ") || "—";
      const ids = [record[1] ? `№ ${record[1]}` : null, record[2] || record[3] ? `VIN ${record[2] || record[3]}` : null]
        .filter(Boolean).join(" · ");
      const dateLabel = language === "ru" ? "дата незаконного завладения" : "дата незаконного заволодіння";
      lines.push(`• ${escapeHtml(identity)}${ids ? ` · ${escapeHtml(ids)}` : ""} · ${dateLabel}: ${formatDate(record[7])}`);
    }
  } else if (check.status === "clear") {
    lines.push(language === "ru"
      ? "✅ Совпадений в открытом реестре разыскиваемых транспортных средств не найдено. Это не гарантирует отсутствие розыска."
      : "✅ Збігів у відкритому реєстрі розшукуваних транспортних засобів не знайдено. Це не гарантує відсутність розшуку.");
  } else {
    lines.push(language === "ru"
      ? "⚪ Реестр розыска сейчас недоступен — бот не делает вывод об отсутствии совпадений."
      : "⚪ Реєстр розшуку зараз недоступний — бот не робить висновок про відсутність збігів.");
  }
  if (check.checkedAt) lines.push(`${language === "ru" ? "Проверено по версии" : "Перевірено за версією"}: ${formatDate(check.checkedAt)}`);
  if (check.sourceUrl) lines.push(`<a href="${escapeHtml(check.sourceUrl)}">${language === "ru" ? "Источник: Национальная полиция Украины" : "Джерело: Національна поліція України"}</a>`);
  return lines;
}

export function renderWantedCheck(check: WantedCheck, language: Language): string {
  return fitLines(wantedLines(check, language));
}

export function renderVehicleAnalytics(
  match: VehicleMatch,
  wanted: WantedCheck,
  language: Language,
  now: Date = new Date(),
  historyStartYear = 2013,
): string {
  const vehicle = match.vehicle;
  const events = orderedEvents(vehicle.e ?? []);
  const lines: string[] = [...wantedLines(wanted, language), ""];
  const vin = vehicle.v?.toUpperCase() ?? null;
  const vinValid = Boolean(vin && VIN_RE.test(vin));
  const vinIssues: string[] = [];
  lines.push(`🔢 <b>${language === "ru" ? "Анализ VIN" : "Аналіз VIN"}</b>`);
  if (!vin) {
    lines.push(language === "ru" ? "VIN отсутствует в открытой записи МВД." : "VIN відсутній у відкритому записі МВС.");
  } else {
    const wmi = vin.slice(0, 3);
    const wmiInfo = WMI[wmi];
    const decodedYear = modelYear(vin, vehicle.y);
    lines.push(`VIN: <code>${escapeHtml(vin)}</code>`);
    lines.push(`WMI: <code>${escapeHtml(wmi)}</code>`);
    lines.push(`${language === "ru" ? "Регион производителя" : "Регіон виробника"}: ${vinRegion(vin[0] ?? "", language)}`);
    if (wmiInfo) {
      lines.push(`${language === "ru" ? "Производитель по WMI" : "Виробник за WMI"}: ${escapeHtml(wmiInfo.manufacturer)}`);
      lines.push(`${language === "ru" ? "Страна WMI" : "Країна WMI"}: ${escapeHtml(wmiInfo.country)}`);
      if (!brandMatches(wmiInfo.manufacturer, vehicle.b)) vinIssues.push(language === "ru" ? "марка по WMI не совпадает с маркой МВД" : "марка за WMI не збігається з маркою МВС");
    } else {
      lines.push(language === "ru" ? "Производитель по WMI: не определён локальным справочником" : "Виробник за WMI: не визначений локальним довідником");
    }
    lines.push(`${language === "ru" ? "Модельный год по VIN" : "Модельний рік за VIN"}: ${decodedYear ?? (language === "ru" ? "код не применим" : "код не застосовується")}`);
    lines.push(`${language === "ru" ? "Код завода (11-й символ)" : "Код заводу (11-й символ)"}: <code>${escapeHtml(vin[10] ?? "—")}</code>`);
    lines.push(`VIS: <code>${escapeHtml(vin.slice(9))}</code> · ${language === "ru" ? "серийная часть" : "серійна частина"}: <code>${escapeHtml(vin.slice(11))}</code>`);
    lines.push(vinValid
      ? (language === "ru" ? "✅ Структура VIN соответствует формату из 17 допустимых символов." : "✅ Структура VIN відповідає формату з 17 допустимих символів.")
      : (language === "ru" ? "⚠️ Структура VIN не соответствует стандартному 17-символьному формату." : "⚠️ Структура VIN не відповідає стандартному 17-символьному формату."));
    if (decodedYear && vehicle.y && Math.abs(decodedYear - vehicle.y) > 1) vinIssues.push(language === "ru" ? "модельный год VIN отличается от года МВД" : "модельний рік VIN відрізняється від року МВС");
    const digit = vinValid ? checkDigit(vin) : null;
    if (digit) lines.push(digit.matches
      ? (language === "ru" ? "✅ Контрольная цифра VIN совпадает (североамериканская методика)." : "✅ Контрольна цифра VIN збігається (північноамериканська методика).")
      : (language === "ru" ? `⚠️ Контрольная цифра VIN не совпадает: ожидается ${digit.expected}.` : `⚠️ Контрольна цифра VIN не збігається: очікується ${digit.expected}.`));
    else lines.push(language === "ru" ? "ℹ️ Контрольная цифра не оценивается для этого региона VIN." : "ℹ️ Контрольна цифра не оцінюється для цього регіону VIN.");
    lines.push(language === "ru" ? "✅ VIN связан с найденной записью в открытом реестре МВД." : "✅ VIN пов’язаний зі знайденим записом у відкритому реєстрі МВС.");
    for (const issue of vinIssues) lines.push(`⚠️ ${issue}.`);
  }

  const first = events.find((event) => parseDate(event[0])) ?? events[0];
  const firstDate = parseDate(first?.[0]);
  lines.push("", `🌍 <b>${language === "ru" ? "Регистрация и импорт" : "Реєстрація та імпорт"}</b>`);
  lines.push(`${language === "ru" ? "Первое известное событие в доступной истории Украины" : "Перша відома подія в доступній історії України"}: ${formatDate(first?.[0])}`);
  lines.push(`${language === "ru" ? "Тип операции" : "Тип операції"}: ${escapeHtml(first?.[2] || first?.[1] || "—")}`);
  if (isImported(first?.[2])) lines.push(language === "ru" ? "✅ Первая операция содержит признак ввоза из-за границы." : "✅ Перша операція містить ознаку ввезення з-за кордону.");
  else lines.push(language === "ru" ? "ℹ️ Первая открытая операция не подтверждает и не исключает импорт." : "ℹ️ Перша відкрита операція не підтверджує і не виключає імпорт.");
  if (firstDate) lines.push(`${language === "ru" ? "В Украине минимум" : "В Україні щонайменше"}: ${formatDuration(daysBetween(firstDate, now), language)}`);

  const ownerEvents = events.filter((event) => isOwnerChange(event[2]));
  const ownerDates = ownerEvents.map((event) => parseDate(event[0])).filter((date): date is Date => Boolean(date));
  lines.push("", `👥 <b>${language === "ru" ? "История владения" : "Історія володіння"}</b>`);
  lines.push(`${language === "ru" ? "Регистрационных событий" : "Реєстраційних подій"}: ${events.length}`);
  lines.push(`${language === "ru" ? "Предполагаемых смен владельца в доступной истории" : "Ймовірних змін власника в доступній історії"}: ${ownerEvents.length}`);
  if (vehicle.y !== null && vehicle.y < historyStartYear) {
    lines.push(language === "ru"
      ? "⚠️ Реальное число предыдущих владельцев может быть больше из-за ограниченного периода доступных данных."
      : "⚠️ Реальна кількість попередніх власників може бути більшою через обмежений період доступних даних.");
  }
  if (firstDate) lines.push(`${language === "ru" ? "Средний период владения" : "Середній період володіння"}: ${formatDuration(daysBetween(firstDate, now) / Math.max(1, ownerEvents.length + 1), language)}`);

  const plateEvents = events.filter((event) => event[3] && event[0]);
  const plateSegments: Array<{ plate: string; start: string; end: string | null }> = [];
  for (const event of plateEvents) {
    const plate = event[3];
    const date = event[0];
    if (!plate || !date) continue;
    const previous = plateSegments.at(-1);
    if (previous?.plate === plate) continue;
    if (previous) previous.end = date;
    plateSegments.push({ plate, start: date, end: null });
  }
  lines.push("", `🔖 <b>${language === "ru" ? "История номеров автомобиля" : "Історія номерів автомобіля"}</b>`);
  for (const segment of plateSegments.slice(-6)) {
    lines.push(`${escapeHtml(segment.plate)} · ${segment.start.slice(0, 4)}–${segment.end?.slice(0, 4) ?? (language === "ru" ? "н.в." : "дотепер")}`);
  }
  lines.push(`${language === "ru" ? "Всего известных номеров" : "Усього відомих номерів"}: ${new Set(plateEvents.map((event) => event[3])).size}`);

  const regionRows = events.filter((event) => event[4] && event[0]);
  const regions: Array<{ year: string; value: string }> = [];
  for (const event of regionRows) {
    if (!event[4] || !event[0] || regions.at(-1)?.value === event[4]) continue;
    regions.push({ year: event[0].slice(0, 4), value: event[4] });
  }
  lines.push("", `📍 <b>${language === "ru" ? "История регионов" : "Історія регіонів"}</b>`);
  for (const region of regions.slice(-6)) lines.push(`${region.year} — ${escapeHtml(region.value)}`);
  lines.push(`${language === "ru" ? "Известных регионов регистрации" : "Відомих регіонів реєстрації"}: ${new Set(regions.map((region) => region.value)).size}`);
  if (regions.length >= 3) lines.push(language === "ru" ? "⚠️ Автомобиль неоднократно перерегистрировался между регионами; это не является доказательством проблемы." : "⚠️ Автомобіль неодноразово перереєстровувався між регіонами; це не є доказом проблеми.");

  const fields: Array<{ labelRu: string; labelUk: string; index: number; suffix?: string }> = [
    { labelRu: "Цвет", labelUk: "Колір", index: 6 },
    { labelRu: "Топливо", labelUk: "Паливо", index: 7 },
    { labelRu: "Объём двигателя", labelUk: "Об’єм двигуна", index: 8, suffix: " см³" },
    { labelRu: "Кузов", labelUk: "Кузов", index: 9 },
    { labelRu: "Назначение", labelUk: "Призначення", index: 10 },
    { labelRu: "Собственная масса", labelUk: "Власна маса", index: 11, suffix: " кг" },
    { labelRu: "Полная масса", labelUk: "Повна маса", index: 12, suffix: " кг" },
    { labelRu: "Тип ТС", labelUk: "Тип ТЗ", index: 13 },
  ];
  const changedFields: string[] = [];
  for (const field of fields) {
    const values: Array<{ year: string; value: string }> = [];
    for (const event of events) {
      const raw = event[field.index];
      if (raw === null || raw === undefined || !event[0]) continue;
      const value = `${raw}${field.suffix ?? ""}`;
      if (values.at(-1)?.value !== value) values.push({ year: event[0].slice(0, 4), value });
    }
    if (new Set(values.map((item) => item.value)).size > 1) {
      const label = language === "ru" ? field.labelRu : field.labelUk;
      changedFields.push(`${label}: ${values.slice(-4).map((item) => `${item.year} — ${escapeHtml(item.value)}`).join(" → ")}`);
    }
  }
  lines.push("", `🔧 <b>${language === "ru" ? "Изменения характеристик" : "Зміни характеристик"}</b>`);
  if (changedFields.length) {
    lines.push(...changedFields.slice(0, 6));
    lines.push(language === "ru" ? "⚠️ Изменения найдены в регистрационных данных; они могут быть результатом официального переоборудования." : "⚠️ Зміни знайдені в реєстраційних даних; вони можуть бути наслідком офіційного переобладнання.");
  } else {
    lines.push(language === "ru" ? "Изменений в доступных исторических характеристиках не найдено." : "Змін у доступних історичних характеристиках не знайдено.");
  }

  const resalePeriods: number[] = [];
  if (firstDate) {
    let previous = firstDate;
    for (const date of ownerDates) {
      if (date > previous) resalePeriods.push(daysBetween(previous, date));
      previous = date;
    }
  }
  lines.push("", `📊 <b>${language === "ru" ? "История перепродаж" : "Історія перепродажів"}</b>`);
  if (resalePeriods.length) {
    for (const days of resalePeriods.slice(-5)) {
      const marker = days < 90 ? "🔴" : days < 365 ? "🟡" : "🟢";
      lines.push(`${marker} ${language === "ru" ? "Период владения" : "Період володіння"}: ${formatDuration(days, language)}`);
    }
  } else lines.push(language === "ru" ? "Подтверждённых интервалов между сменами владельца недостаточно." : "Підтверджених інтервалів між змінами власника недостатньо.");
  const quickResale = resalePeriods.some((days) => days < 244);
  if (quickResale) lines.push(language === "ru" ? "⚠️ Обнаружена предполагаемая быстрая перепродажа менее чем за 8 месяцев." : "⚠️ Виявлено ймовірний швидкий перепродаж менш ніж за 8 місяців.");

  let score = 100;
  if (wanted.status === "match") score -= 50;
  score -= Math.min(20, Math.max(0, ownerEvents.length - 2) * 5);
  if (quickResale) score -= 15;
  score -= Math.min(15, changedFields.length * 5);
  score -= Math.min(30, vinIssues.length * 15);
  score = Math.max(0, score);
  lines.push("", `📈 <b>${language === "ru" ? "Индекс истории" : "Індекс історії"}: ${score}/100</b>`);
  lines.push(language === "ru" ? "Собственная аналитическая оценка сервиса, не официальный рейтинг и не заключение о состоянии автомобиля." : "Власна аналітична оцінка сервісу, не офіційний рейтинг і не висновок про стан автомобіля.");
  lines.push("", language === "ru"
    ? "🚧 ДТП: персональная проверка по VIN/номеру не выполняется — открытая статистика ДТП не позволяет достоверно связать событие с конкретным автомобилем."
    : "🚧 ДТП: персональна перевірка за VIN/номером не виконується — відкрита статистика ДТП не дає змоги достовірно пов’язати подію з конкретним автомобілем.");
  return fitLines(lines);
}
