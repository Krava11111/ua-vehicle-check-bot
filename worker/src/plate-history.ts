import type { CompactPlateAssignment, Language, PlateHistoryResult } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function assignmentLines(
  assignment: CompactPlateAssignment,
  index: number,
  language: Language,
): string[] {
  const [, vin, brand, model, year, color, , first, last, count, confidence] = assignment;
  const unknown = language === "ru" ? "нет данных" : "немає даних";
  const title = [brand, model].filter(Boolean).map(escapeHtml).join(" ") || unknown;
  const confidenceLabels = language === "ru"
    ? { HIGH: "высокая", MEDIUM: "средняя", LOW: "низкая" }
    : { HIGH: "висока", MEDIUM: "середня", LOW: "низька" };
  const lines = [`\n${index}️⃣ <b>${title}</b>`];
  if (year) lines.push(`📅 ${language === "ru" ? "Год" : "Рік"}: ${year}`);
  if (color) lines.push(`🎨 ${language === "ru" ? "Цвет" : "Колір"}: ${escapeHtml(color)}`);
  if (vin) lines.push(`🔢 VIN: <code>${escapeHtml(vin)}</code>`);
  if (count <= 1 || first === last) {
    lines.push(
      `${language === "ru" ? "Первое известное появление номера" : "Перша відома поява номера"}: ${formatDate(first)}`,
    );
  } else {
    lines.push(
      language === "ru"
        ? `Известный период использования номера по доступным данным:\n${formatDate(first)} → ${formatDate(last)}`
        : `Відомий період використання номера за доступними даними:\n${formatDate(first)} → ${formatDate(last)}`,
    );
  }
  lines.push(
    `${language === "ru" ? "Регистрационных событий" : "Реєстраційних подій"}: ${count}`,
    `${language === "ru" ? "Уверенность периода" : "Впевненість періоду"}: ${confidenceLabels[confidence]}`,
  );
  return lines;
}

function splitLines(lines: string[], limit = 3_900): string[] {
  const parts: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n\n${line}` : line;
    if (current && candidate.length > limit) {
      parts.push(current);
      current = line;
    } else current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

export function renderPlateHistory(
  result: PlateHistoryResult,
  language: Language,
  historyStartYear: number,
  sourceLabel: string,
  sourceUrl: string,
  dataCoverageThrough: string | null = null,
  datasetUpdatedAt: string | null = null,
  updateFrequency: string | null = null,
): string[] {
  const lines = [
    language === "ru" ? "🔖 <b>ИСТОРИЯ НОМЕРНОГО ЗНАКА</b>" : "🔖 <b>ІСТОРІЯ НОМЕРНОГО ЗНАКА</b>",
    `<code>${escapeHtml(result.plate)}</code>`,
    result.totalAssignments === 1
      ? (language === "ru" ? "В доступных данных номер связан с одним автомобилем." : "У доступних даних номер пов’язаний з одним автомобілем.")
      : (language === "ru" ? `В доступной базе найдено автомобилей: ${result.totalAssignments}` : `У доступній базі знайдено автомобілів: ${result.totalAssignments}`),
  ];
  for (const [index, assignment] of result.assignments.entries()) {
    lines.push(...assignmentLines(assignment, index + 1, language));
  }
  if (result.totalAssignments > 1) {
    lines.push(
      language === "ru"
        ? "ℹ️ Государственные номера могут повторно использоваться или переноситься между транспортными средствами. Номер не является постоянным уникальным идентификатором автомобиля; основным идентификатором является VIN, если он доступен."
        : "ℹ️ Державні номери можуть повторно використовуватися або переноситися між транспортними засобами. Номер не є постійним унікальним ідентифікатором автомобіля; основним ідентифікатором є VIN, якщо він доступний.",
    );
  }
  if (result.assignments.some((assignment) => !assignment[1])) {
    lines.push(
      language === "ru"
        ? "⚠️ Некоторые записи без VIN невозможно однозначно связать с конкретным автомобилем. Они сгруппированы консервативно по доступным характеристикам."
        : "⚠️ Деякі записи без VIN неможливо однозначно пов’язати з конкретним автомобілем. Їх згруповано консервативно за доступними характеристиками.",
    );
  }
  const dated = result.assignments.filter((assignment) => assignment[7] && assignment[8]);
  const shortTransition = dated.some((assignment, index) => {
    const next = dated[index + 1];
    if (!next || !assignment[8] || !next[7]) return false;
    const gap = (Date.parse(next[7]) - Date.parse(assignment[8])) / 86_400_000;
    return gap >= 0 && gap <= 7;
  });
  if (shortTransition) {
    lines.push(
      language === "ru"
        ? "⚠️ Номер связан с несколькими автомобилями в течение короткого известного периода. Причина по этим данным не определяется."
        : "⚠️ Номер пов’язаний із кількома автомобілями протягом короткого відомого періоду. Причина за цими даними не визначається.",
    );
  }
  if (result.truncated) {
    lines.push(
      language === "ru"
        ? `⚠️ Показаны первые ${result.assignments.length} из ${result.totalAssignments} найденных связей.`
        : `⚠️ Показано перші ${result.assignments.length} із ${result.totalAssignments} знайдених зв’язків.`,
    );
  }
  if (result.source === "vehicle-fallback") {
    lines.push(
      language === "ru"
        ? "ℹ️ Использован совместимый режим старого индекса; после следующего обновления GitHub Release история станет полнее."
        : "ℹ️ Використано сумісний режим старого індексу; після наступного оновлення GitHub Release історія стане повнішою.",
    );
  }
  lines.push(
    language === "ru"
      ? `ℹ️ <b>О данных</b>\nИстория построена по доступным регистрационным данным примерно с ${historyStartYear} года. Более ранние назначения номера могут отсутствовать. Это не полная история.`
      : `ℹ️ <b>Про дані</b>\nІсторія побудована за доступними реєстраційними даними приблизно з ${historyStartYear} року. Ранніші призначення номера можуть бути відсутні. Це не повна історія.`,
    dataCoverageThrough
      ? `📅 ${language === "ru" ? "Данные реестра по" : "Дані реєстру по"}: ${formatDate(dataCoverageThrough)} ${language === "ru" ? "включительно" : "включно"}`
      : "",
    updateFrequency === "monthly"
      ? `🔄 ${language === "ru" ? "База обновляется раз в месяц" : "База оновлюється раз на місяць"}.`
      : "",
    datasetUpdatedAt
      ? `🕓 ${language === "ru" ? "Последнее обновление источника" : "Останнє оновлення джерела"}: ${formatDate(datasetUpdatedAt.slice(0, 10))}`
      : "",
    `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceLabel)}</a>`,
  );
  return splitLines(lines.filter(Boolean));
}
