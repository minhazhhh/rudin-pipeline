import { parse } from "csv-parse/sync";

export async function fetchCsvRows(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet (${res.status} ${res.statusText}). Make sure it's published to the web as CSV.`);
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
}

export function csvNum(v: string | undefined): number | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function csvBool(v: string | undefined): boolean {
  if (!v) return false;
  return ["true", "1", "yes", "y"].includes(v.trim().toLowerCase());
}

export function csvStr(v: string | undefined): string {
  return v ?? "";
}
