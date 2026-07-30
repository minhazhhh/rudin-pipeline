import fs from "node:fs";
import path from "node:path";
import { loadDashboardData } from "@/app/lib/render-data";
import type { PreviewChanges } from "@/app/lib/render-data";
import { prisma } from "@/app/lib/prisma";
import { draftMode } from "next/headers";

export const dynamic = "force-dynamic";

const TEMPLATE_PATH = path.join(process.cwd(), "app", "lib", "dashboard-template.html");
const template = fs.readFileSync(TEMPLATE_PATH, "utf8");

// Escape "<" so no JSON string value can prematurely close the surrounding <script> tag.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildPreviewHighlightScript(changes: PreviewChanges): string {
  const newProjects = JSON.stringify(changes.newProjects);
  const changedProjects = JSON.stringify(changes.changedProjects);
  const newBuildings = JSON.stringify(changes.newBuildings);
  const changedBuildings = JSON.stringify(changes.changedBuildings);
  const resourcesReplaced = JSON.stringify(changes.resourcesReplaced);
  return `
<style>
.preview-new-badge{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.5px;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:5px;background:#22c55e;color:#052e16;text-transform:uppercase}
.preview-changed-badge{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.5px;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:5px;background:#facc15;color:#422006;text-transform:uppercase}
.preview-highlight-new{outline:2px solid #22c55e!important;outline-offset:-2px}
.preview-highlight-changed{outline:2px solid #facc15!important;outline-offset:-2px}
.preview-tab-notice{display:flex;align-items:center;gap:8px;padding:7px 12px;margin-bottom:10px;border-radius:5px;background:rgba(250,204,21,.1);color:#fde047;border:1px solid rgba(250,204,21,.25);font-size:11px;font-weight:600;letter-spacing:.01em}
.preview-tab-notice-icon{font-style:normal;flex-shrink:0}
</style>
<script>
(function() {
  var NEW_PROJECTS = ${newProjects};
  var CHANGED_PROJECTS = ${changedProjects};
  var NEW_BUILDINGS = ${newBuildings};
  var CHANGED_BUILDINGS = ${changedBuildings};
  var RESOURCES_REPLACED = ${resourcesReplaced};

  // ── Project card highlights ──────────────────────────────────────────────
  function applyProjectHighlights() {
    if (typeof DATA === 'undefined') return;
    DATA.forEach(function(p, i) {
      var el = document.getElementById('pi-' + i);
      if (!el) return;
      var isNew = NEW_PROJECTS.indexOf(p.n) !== -1;
      var isChanged = CHANGED_PROJECTS.indexOf(p.n) !== -1;
      if (!isNew && !isChanged) return;
      el.classList.add(isNew ? 'preview-highlight-new' : 'preview-highlight-changed');
      var pinDiv = el.querySelector('.pin');
      if (pinDiv && !pinDiv.querySelector('.preview-new-badge,.preview-changed-badge')) {
        var badge = document.createElement('span');
        badge.className = isNew ? 'preview-new-badge' : 'preview-changed-badge';
        badge.textContent = isNew ? 'NEW' : 'UPDATED';
        pinDiv.appendChild(badge);
      }
    });
  }

  // ── Building row highlights (By Building tab) ────────────────────────────
  function applyBldgHighlights() {
    document.querySelectorAll('[data-bldg]').forEach(function(tr) {
      var bName = tr.getAttribute('data-bldg');
      var isNew = NEW_BUILDINGS.indexOf(bName) !== -1;
      var isChanged = CHANGED_BUILDINGS.indexOf(bName) !== -1;
      if (!isNew && !isChanged) return;
      tr.classList.add(isNew ? 'preview-highlight-new' : 'preview-highlight-changed');
      var nameCell = tr.querySelector('td:nth-child(2)');
      if (nameCell && !nameCell.querySelector('.preview-new-badge,.preview-changed-badge')) {
        var badge = document.createElement('span');
        badge.className = isNew ? 'preview-new-badge' : 'preview-changed-badge';
        badge.textContent = isNew ? 'NEW' : 'UPDATED';
        nameCell.appendChild(badge);
      }
    });
  }

  // ── Per-tab data-change notices ─────────────────────────────────────────
  function makeNotice(msg) {
    var d = document.createElement('div');
    d.className = 'preview-tab-notice';
    d.innerHTML = '<em class="preview-tab-notice-icon">&#9888;</em><span>' + msg + '</span>';
    return d;
  }

  function injectNotice(el, msg) {
    if (!el || el.querySelector('.preview-tab-notice')) return;
    el.insertBefore(makeNotice(msg), el.firstChild);
  }

  function applyTabNotices() {
    var hasOverall  = RESOURCES_REPLACED.indexOf('overall-stats') !== -1;
    var hasTypeSt   = RESOURCES_REPLACED.indexOf('type-stats') !== -1;
    var hasBldgSt   = RESOURCES_REPLACED.indexOf('comp-building-stats') !== -1;
    var hasTrend    = RESOURCES_REPLACED.indexOf('trend') !== -1;
    var hasQtrSt    = RESOURCES_REPLACED.indexOf('comp-building-quarter-stats') !== -1;

    if (hasOverall || hasTypeSt) {
      injectNotice(document.getElementById('cd-overview'),
        'Market-wide stats updated in this import — figures reflect incoming data');
    }
    if (hasTypeSt || hasBldgSt) {
      injectNotice(document.getElementById('cd-bytype'),
        'Property type breakdown updated in this import');
    }
    if (hasTrend) {
      injectNotice(document.getElementById('cd-trend'),
        'Trend data updated in this import');
    }
    if (hasQtrSt) {
      injectNotice(document.getElementById('cd-report'),
        'Quarterly building stats updated in this import');
    }
    if (NEW_BUILDINGS.length || CHANGED_BUILDINGS.length) {
      var parts = [];
      if (NEW_BUILDINGS.length) parts.push(NEW_BUILDINGS.length + ' new building' + (NEW_BUILDINGS.length !== 1 ? 's' : ''));
      if (CHANGED_BUILDINGS.length) parts.push(CHANGED_BUILDINGS.length + ' updated building' + (CHANGED_BUILDINGS.length !== 1 ? 's' : ''));
      injectNotice(document.getElementById('cd-bybldg'),
        parts.join(', ') + ' in this import — highlighted rows below');
    }
  }

  // ── Banner detail text ──────────────────────────────────────────────────
  function updateBannerDetails() {
    var banner = document.getElementById('import-preview-banner');
    if (!banner) return;
    var detail = banner.querySelector('span[style*="flex:1"], span[style*="flex: 1"]');
    if (!detail) return;

    var parts = [];
    if (NEW_PROJECTS.length) parts.push('<span style="color:#86efac;font-weight:700">' + NEW_PROJECTS.length + ' new project' + (NEW_PROJECTS.length !== 1 ? 's' : '') + '</span>');
    if (CHANGED_PROJECTS.length) parts.push('<span style="color:#fde047;font-weight:700">' + CHANGED_PROJECTS.length + ' updated project' + (CHANGED_PROJECTS.length !== 1 ? 's' : '') + '</span>');
    if (NEW_BUILDINGS.length) parts.push('<span style="color:#86efac;font-weight:700">' + NEW_BUILDINGS.length + ' new comp building' + (NEW_BUILDINGS.length !== 1 ? 's' : '') + '</span>');
    if (CHANGED_BUILDINGS.length) parts.push('<span style="color:#fde047;font-weight:700">' + CHANGED_BUILDINGS.length + ' updated comp building' + (CHANGED_BUILDINGS.length !== 1 ? 's' : '') + '</span>');
    if (RESOURCES_REPLACED.indexOf('overall-stats') !== -1) parts.push('<span style="color:#fde047;font-weight:700">market stats</span>');
    if (RESOURCES_REPLACED.indexOf('trend') !== -1) parts.push('<span style="color:#fde047;font-weight:700">trend data</span>');

    if (parts.length) {
      var existing = detail.innerHTML;
      var dashIdx = existing.indexOf(' — ');
      var prefix = dashIdx !== -1 ? existing.slice(0, dashIdx) : existing;
      detail.innerHTML = prefix + ' — ' + parts.join(', ');
    }
  }

  // ── Wire everything up ──────────────────────────────────────────────────
  function watchAndHighlight() {
    // Project list re-renders on filter/sort
    var plist = document.getElementById('plist');
    if (plist) {
      new MutationObserver(applyProjectHighlights).observe(plist, { childList: true });
    }

    // Building tab: full re-render fires on container; filter fires on tbody
    var bybldg = document.getElementById('cd-bybldg');
    if (bybldg) {
      new MutationObserver(function() { applyTabNotices(); applyBldgHighlights(); })
        .observe(bybldg, { childList: true });
    }
    var bldgTbody = document.getElementById('cd-bldg-tbody');
    if (bldgTbody) {
      new MutationObserver(applyBldgHighlights).observe(bldgTbody, { childList: true });
    }

    // Stat tabs: re-render fires when tab is first opened
    ['cd-overview', 'cd-bytype', 'cd-trend', 'cd-report'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) new MutationObserver(applyTabNotices).observe(el, { childList: true });
    });

    // Apply all on initial load
    applyProjectHighlights();
    applyBldgHighlights();
    applyTabNotices();
    updateBannerDetails();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchAndHighlight);
  } else {
    setTimeout(watchAndHighlight, 0);
  }
})();
</script>`;
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

function buildImportPreviewBanner(resourceCount: number, totalRows: number, fileName: string): string {
  return `
<div id="import-preview-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1e3a5f;color:#e8f0fe;padding:10px 20px;display:flex;align-items:center;gap:14px;font-family:'Basis Grotesque','Inter',sans-serif;font-size:13px;font-weight:500;box-shadow:0 -2px 12px rgba(0,0,0,.28)">
  <span style="font-size:15px">📥</span>
  <strong style="font-size:13px;letter-spacing:.2px;color:#93c5fd">IMPORT PREVIEW</strong>
  <span style="color:#a0b8d8;flex:1">${resourceCount} resource${resourceCount !== 1 ? "s" : ""}, ${totalRows} rows from <em style="color:#e8f0fe">${fileName.replace(/</g, "&lt;")}</em> — data not yet saved</span>
  <button onclick="importPreviewConfirm()" style="padding:5px 14px;background:#1d8a5c;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:.2px">Confirm import &amp; go live</button>
  <a href="/api/comps-import/preview?exit=1" onclick="return importPreviewExit()" style="padding:5px 12px;background:rgba(255,255,255,.1);color:#e8f0fe;border-radius:4px;font-size:12px;text-decoration:none;font-weight:600">Exit preview</a>
</div>
<script>
async function importPreviewConfirm() {
  if (!confirm('Import ${totalRows} rows across ${resourceCount} resource${resourceCount !== 1 ? "s" : ""} to the live site? This cannot be undone.')) return;
  const btn = document.querySelector('#import-preview-banner button');
  if (btn) btn.textContent = 'Importing…';
  const r = await fetch('/api/comps-import/preview/confirm', {method:'POST'});
  const d = await r.json().catch(()=>({}));
  if (!r.ok || d.failed > 0) {
    alert((d.errors||[]).join('\\n') || 'Import failed.');
    if (btn) btn.textContent = 'Confirm import &amp; go live';
    return;
  }
  location.href = '/';
}
async function importPreviewExit(e) {
  if (e) e.preventDefault();
  await fetch('/api/comps-import/preview', {method:'DELETE'});
  location.href = '/admin/sync';
  return false;
}
</script>`;
}

export async function GET() {
  const { isEnabled: isPreview } = await draftMode();

  let drafts: Awaited<ReturnType<typeof prisma.adminDraft.findMany>> = [];
  let importPreviewRecord: Awaited<ReturnType<typeof prisma.importPreview.findFirst>> = null;

  if (isPreview) {
    [drafts, importPreviewRecord] = await Promise.all([
      prisma.adminDraft.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.importPreview.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);
  }

  const importPreviewResources = importPreviewRecord
    ? (importPreviewRecord.resources as Record<string, Record<string, string>[]>)
    : undefined;

  const { DATA, YEARS, maxUnits, maxSf, COMP_COORDS, AGG, BSTATS, NAME_MAP, previewChanges } = await loadDashboardData(
    isPreview && !importPreviewRecord ? drafts : undefined,
    importPreviewResources
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
    if (importPreviewRecord) {
      const resources = importPreviewResources!;
      const resourceCount = Object.keys(resources).length;
      const totalRows = Object.values(resources).reduce((s, r) => s + r.length, 0);
      let inject = buildImportPreviewBanner(resourceCount, totalRows, importPreviewRecord.fileName);
      if (previewChanges) {
        inject += buildPreviewHighlightScript(previewChanges);
      }
      html = html.replace("</body>", inject + "\n</body>");
    } else if (drafts.length > 0) {
      html = html.replace("</body>", buildPreviewBanner(drafts.length) + "\n</body>");
    }
  }

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
