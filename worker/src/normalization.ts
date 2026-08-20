import type { Language } from "./types.js";

const CYRILLIC_TO_LATIN: Record<string, string> = {
  "А": "A", "В": "B", "Е": "E", "І": "I", "К": "K", "М": "M",
  "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X",
};
const PLATE_RE = /^[ABCEHIKMOPTX]{2}\d{4}[ABCEHIKMOPTX]{2}$/;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizePlate(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  const candidate = [...compact].map((character) => CYRILLIC_TO_LATIN[character] ?? character).join("");
  return PLATE_RE.test(candidate) ? candidate : null;
}

export function normalizeVin(value: string): string | null {
  const candidate = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  return VIN_RE.test(candidate) ? candidate : null;
}

export function detectQuery(value: string): { kind: "PLATE" | "VIN"; normalized: string } | null {
  const vin = normalizeVin(value);
  if (vin) return { kind: "VIN", normalized: vin };
  const plate = normalizePlate(value);
  if (plate) return { kind: "PLATE", normalized: plate };
  return null;
}

export function languageFor(code: string | undefined, fallback = "uk"): Language {
  if (code?.toLowerCase().startsWith("ru")) return "ru";
  return fallback === "ru" ? "ru" : "uk";
}
