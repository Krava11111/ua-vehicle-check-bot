import type { CompactEvent, Language } from "./types.js";

const REGION_BY_CODE: Record<string, { uk: string; ru: string }> = {
  "01": { uk: "Автономна Республіка Крим", ru: "Автономная Республика Крым" },
  "05": { uk: "Вінницька область", ru: "Винницкая область" },
  "07": { uk: "Волинська область", ru: "Волынская область" },
  "12": { uk: "Дніпропетровська область", ru: "Днепропетровская область" },
  "14": { uk: "Донецька область", ru: "Донецкая область" },
  "18": { uk: "Житомирська область", ru: "Житомирская область" },
  "21": { uk: "Закарпатська область", ru: "Закарпатская область" },
  "23": { uk: "Запорізька область", ru: "Запорожская область" },
  "26": { uk: "Івано-Франківська область", ru: "Ивано-Франковская область" },
  "32": { uk: "Київська область", ru: "Киевская область" },
  "35": { uk: "Кіровоградська область", ru: "Кировоградская область" },
  "44": { uk: "Луганська область", ru: "Луганская область" },
  "46": { uk: "Львівська область", ru: "Львовская область" },
  "48": { uk: "Миколаївська область", ru: "Николаевская область" },
  "51": { uk: "Одеська область", ru: "Одесская область" },
  "53": { uk: "Полтавська область", ru: "Полтавская область" },
  "56": { uk: "Рівненська область", ru: "Ровненская область" },
  "59": { uk: "Сумська область", ru: "Сумская область" },
  "61": { uk: "Тернопільська область", ru: "Тернопольская область" },
  "63": { uk: "Харківська область", ru: "Харьковская область" },
  "65": { uk: "Херсонська область", ru: "Херсонская область" },
  "68": { uk: "Хмельницька область", ru: "Хмельницкая область" },
  "71": { uk: "Черкаська область", ru: "Черкасская область" },
  "73": { uk: "Чернівецька область", ru: "Черновицкая область" },
  "74": { uk: "Чернігівська область", ru: "Черниговская область" },
  "80": { uk: "Київ", ru: "Киев" },
  "85": { uk: "Севастополь", ru: "Севастополь" },
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
}

export function orderedEvents(events: CompactEvent[]): CompactEvent[] {
  return [...events].sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
}

export class RegionResolver {
  static resolve(raw: string | null | undefined, language: Language): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (!/^\d{5,10}$/.test(value) && !/^UA\d{17}$/i.test(value)) return value;
    const prefix = value.toUpperCase().startsWith("UA") ? value.slice(2, 4) : value.slice(0, 2);
    return REGION_BY_CODE[prefix]?.[language] ?? null;
  }
}

export interface FormattedOperation {
  icon: string;
  label: string;
  original: string | null;
  ownerChange: boolean;
  imported: boolean;
}

export class RegistrationOperationFormatter {
  static format(event: CompactEvent, language: Language): FormattedOperation {
    const original = [event[1], event[2]].filter(Boolean).join(" — ") || null;
    const text = original?.toUpperCase() ?? "";
    const ownerChange = /ЗМІН[АИ].*ВЛАСНИК|НОВ.*ВЛАСНИК|СПАДЩ|УСПАДК|ДАРУВ|КУПІВЛ|ПРОДАЖ|ВІДЧУЖ|ДОГОВ/.test(text)
      || (/ПЕРЕРЕЄСТРАЦ/.test(text) && !/НОМЕР|ДОКУМЕНТ|ПЕРЕОБЛАДН|КОЛЬОР|АГРЕГАТ/.test(text));
    const imported = /ВВЕЗ|ІМПОРТ|МИТН/.test(text);
    if (imported && /ПЕРВИН|ПЕРША|ПЕРВО/.test(text)) {
      return {
        icon: "🌍",
        label: language === "ru" ? "Первая регистрация ввезённого автомобиля" : "Перша реєстрація ввезеного автомобіля",
        original,
        ownerChange,
        imported,
      };
    }
    if (/НОМЕР|ЗНАК/.test(text) && /ЗАМІН|ЗМІН|ВИДАЧ|ПЕРЕРЕЄСТРАЦ/.test(text)) {
      return {
        icon: "🔖",
        label: language === "ru" ? "Замена номерного знака" : "Заміна номерного знака",
        original,
        ownerChange: false,
        imported,
      };
    }
    if (ownerChange) {
      return {
        icon: "👤",
        label: language === "ru" ? "Перерегистрация на нового владельца" : "Перереєстрація на нового власника",
        original,
        ownerChange,
        imported,
      };
    }
    if (/ПЕРВИН|ПЕРША|ПЕРВО/.test(text)) {
      return {
        icon: "📄",
        label: language === "ru" ? "Первое известное регистрационное событие" : "Перша відома реєстраційна подія",
        original,
        ownerChange,
        imported,
      };
    }
    if (/ПЕРЕРЕЄСТРАЦ|ВТОРИН|ПОВТОР/.test(text)) {
      return {
        icon: "🔄",
        label: language === "ru" ? "Регистрационная операция" : "Реєстраційна операція",
        original,
        ownerChange,
        imported,
      };
    }
    return {
      icon: "📄",
      label: language === "ru" ? "Регистрационная операция" : "Реєстраційна операція",
      original,
      ownerChange,
      imported,
    };
  }
}

export function ownerChangeEvents(events: CompactEvent[], language: Language): CompactEvent[] {
  return orderedEvents(events).filter((event) => RegistrationOperationFormatter.format(event, language).ownerChange);
}

export function importedEvent(events: CompactEvent[], language: Language): CompactEvent | null {
  return orderedEvents(events).find((event) => RegistrationOperationFormatter.format(event, language).imported) ?? null;
}
