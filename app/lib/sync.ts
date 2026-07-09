import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

/** Parses raw file bytes (CSV text or an .xlsx workbook) into row objects keyed by header. */
export function parseSheetBuffer(buf: ArrayBuffer, looksLikeExcel: boolean): Record<string, string>[] {
  if (looksLikeExcel) {
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

  const text = new TextDecoder("utf-8").decode(buf);
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
}

export async function fetchCsvRows(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch sheet (${res.status} ${res.statusText}). Make sure it's published/shared as a direct, ` +
        `unauthenticated link (Google Sheets: published-to-web CSV link). For SharePoint/OneDrive files that ` +
        `aren't public, use the file upload option instead.`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  const looksLikeExcel =
    contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || /\.xlsx?(\?|$)/i.test(url);

  const buf = await res.arrayBuffer();
  return parseSheetBuffer(buf, looksLikeExcel);
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
