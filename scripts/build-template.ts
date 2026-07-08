// One-time build of app/lib/dashboard-template.html from the original static
// file: the big embedded data blobs and their derived constants are swapped
// for placeholder tokens that the SSR route fills in with live DB data.
import fs from "node:fs";
import path from "node:path";

const SRC = "/Users/minhazhasan/Downloads/rudin_combined.html";
const OUT = path.join(import.meta.dirname, "..", "app", "lib", "dashboard-template.html");

const lines = fs.readFileSync(SRC, "utf8").split("\n");

function replaceLine(lineNo1Based: number, expectedPrefix: string, newLine: string) {
  const idx = lineNo1Based - 1;
  if (!lines[idx].startsWith(expectedPrefix)) {
    throw new Error(`Line ${lineNo1Based} doesn't start with "${expectedPrefix}": ${lines[idx].slice(0, 80)}`);
  }
  lines[idx] = newLine;
}

replaceLine(1059, "var DATA = [", "var DATA = __DATA_JSON__;");
replaceLine(1061, "var YEARS = [", "var YEARS = __YEARS_JSON__;");
replaceLine(1619, "const COMP_COORDS = {", "const COMP_COORDS = __COMP_COORDS_JSON__;");
replaceLine(1648, "const AGG = {", "const AGG = __AGG_JSON__;");
replaceLine(1649, "const BSTATS = {", "const BSTATS = __BSTATS_JSON__;");
replaceLine(1650, "const NAME_MAP = {", "const NAME_MAP = __NAME_MAP_JSON__;");

let html = lines.join("\n");

// These are derived from DATA (max units / max sf across all projects) and
// hardcoded throughout the filter UI; replace with tokens the SSR route fills.
html = html.split("1602").join("__MAX_UNITS__");
html = html.split("1406044").join("__MAX_SF__");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${html.length} bytes)`);
