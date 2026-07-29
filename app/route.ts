import fs from "node:fs";
import path from "node:path";
import { loadDashboardData } from "@/app/lib/render-data";
import { prisma } from "@/app/lib/prisma";
import { draftMode } from "next/headers";

export const dynamic = "force-dynamic";

const TEMPLATE_PATH = path.join(process.cwd(), "app", "lib", "dashboard-template.html");
const template = fs.readFileSync(TEMPLATE_PATH, "utf8");

// Escape "<" so no JSON string value can prematurely close the surrounding <script> tag.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildPreviewBanner(draftCount: number): string {
  return `
<div id="draft-preview-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#1a1a1a;padding:10px 20px;display:flex;align-items:center;gap:14px;font-family:'Basis Grotesque','Inter',sans-serif;font-size:13px;font-weight:500;box-shadow:0 -2px 12px rgba(0,0,0,.18)">
  <span style="font-size:15px">🔶</span>
  <strong style="font-size:13px;letter-spacing:.2px">DRAFT PREVIEW</strong>
  <span style="color:#5c3a00;flex:1">${draftCount} staged change${draftCount !== 1 ? "s" : ""} — not yet live on the site</span>
  <button onclick="draftPreviewConfirm()" style="padding:5px 14px;background:#1c4a3a;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:.2px">Confirm all &amp; go live</button>
  <a href="/api/admin/draft-preview/exit" style="padding:5px 12px;background:rgba(0,0,0,.1);color:#1a1a1a;border-radius:4px;font-size:12px;text-decoration:none;font-weight:600">Exit preview</a>
</div>
<script>
async function draftPreviewConfirm() {
  if (!confirm('Apply all ${draftCount} staged change${draftCount !== 1 ? "s" : ""} to the live site? This cannot be undone.')) return;
  const r = await fetch('/api/admin/drafts/confirm', {method:'POST'});
  const d = await r.json().catch(()=>({}));
  if (d.failed > 0) { alert(d.applied + ' applied, ' + d.failed + ' failed:\\n' + (d.errors||[]).join('\\n')); return; }
  location.href = '/';
}
</script>`;
}

export async function GET() {
  const { isEnabled: isPreview } = await draftMode();

  let drafts: Awaited<ReturnType<typeof prisma.adminDraft.findMany>> = [];
  if (isPreview) {
    drafts = await prisma.adminDraft.findMany({ orderBy: { createdAt: "asc" } });
  }

  const { DATA, YEARS, maxUnits, maxSf, COMP_COORDS, AGG, BSTATS, NAME_MAP } = await loadDashboardData(
    isPreview ? drafts : undefined
  );

  let html = template;
  html = html.replace("__DATA_JSON__", () => safeJson(DATA));
  html = html.replace("__YEARS_JSON__", () => safeJson(YEARS));
  html = html.replace("__COMP_COORDS_JSON__", () => safeJson(COMP_COORDS));
  html = html.replace("__AGG_JSON__", () => safeJson(AGG));
  html = html.replace("__BSTATS_JSON__", () => safeJson(BSTATS));
  html = html.replace("__NAME_MAP_JSON__", () => safeJson(NAME_MAP));
  html = html.split("__MAX_UNITS__").join(String(maxUnits));
  html = html.split("__MAX_SF__").join(String(maxSf));

  if (isPreview) {
    html = html.replace("</body>", buildPreviewBanner(drafts.length) + "\n</body>");
  }

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
