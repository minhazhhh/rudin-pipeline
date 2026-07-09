import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export async function fetchCsvRows(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch sheet (${res.status} ${res.statusText}). Make sure it's published/shared as a direct link ` +
        `(Google Sheets: published-to-web CSV link. Excel/SharePoint: a shared "download" link to the .xlsx file).`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  const looksLikeExcel =
    contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || /\.xlsx?(\?|$)/i.test(url);

  if (looksLikeExcel) {
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) as Record<string, unknown>[];
    return rows.map((row) => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key.trim()] = value === null || value === undefined ? "" : String(value).trim();
      }
      return out;
    });
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
