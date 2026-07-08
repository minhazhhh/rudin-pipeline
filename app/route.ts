import fs from "node:fs";
import path from "node:path";
import { loadDashboardData } from "@/app/lib/render-data";

export const dynamic = "force-dynamic";

const TEMPLATE_PATH = path.join(process.cwd(), "app", "lib", "dashboard-template.html");
const template = fs.readFileSync(TEMPLATE_PATH, "utf8");

// Escape "<" so no JSON string value can prematurely close the surrounding <script> tag.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function GET() {
  const { DATA, YEARS, maxUnits, maxSf, COMP_COORDS, AGG, BSTATS, NAME_MAP } = await loadDashboardData();

  let html = template;
  html = html.replace("__DATA_JSON__", () => safeJson(DATA));
  html = html.replace("__YEARS_JSON__", () => safeJson(YEARS));
  html = html.replace("__COMP_COORDS_JSON__", () => safeJson(COMP_COORDS));
  html = html.replace("__AGG_JSON__", () => safeJson(AGG));
  html = html.replace("__BSTATS_JSON__", () => safeJson(BSTATS));
  html = html.replace("__NAME_MAP_JSON__", () => safeJson(NAME_MAP));
  html = html.split("__MAX_UNITS__").join(String(maxUnits));
  html = html.split("__MAX_SF__").join(String(maxSf));

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
