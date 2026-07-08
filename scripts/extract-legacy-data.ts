// One-time extraction of the embedded data blobs from the original static
// dashboard HTML into a plain JSON snapshot, used to seed the database.
import fs from "node:fs";
import path from "node:path";

const SRC = "/Users/minhazhasan/Downloads/rudin_combined.html";
const OUT = path.join(import.meta.dirname, "..", "data", "legacy-data.json");

const lines = fs.readFileSync(SRC, "utf8").split("\n");

function extract(lineNo1Based: number, varName: string): unknown {
  const line = lines[lineNo1Based - 1];
  const prefix = `${varName} = `;
  const start = line.indexOf(prefix);
  if (start === -1) throw new Error(`Expected "${prefix}" on line ${lineNo1Based}, got: ${line.slice(0, 80)}`);
  let jsonText = line.slice(start + prefix.length).trim();
  if (jsonText.endsWith(";")) jsonText = jsonText.slice(0, -1);
  return JSON.parse(jsonText);
}

const DATA = extract(1059, "var DATA");
const COMP_COORDS = extract(1619, "const COMP_COORDS");
const AGG = extract(1648, "const AGG") as {
  ut_stats: Record<string, UnitStatBlob>;
  pt_ut_stats: Record<string, Record<string, UnitStatBlob>>;
  trend: Record<string, Record<string, number>>;
  quarters: string[];
};
const BSTATS = extract(1649, "const BSTATS");
const NAME_MAP = extract(1650, "const NAME_MAP");

type StatTriple = { avg?: number | null; med?: number | null; min?: number | null; max?: number | null; n?: number | null } | null | undefined;
type UnitStatBlob = { gr?: StatTriple; psf?: StatTriple; sf?: StatTriple };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ DATA, COMP_COORDS, AGG, BSTATS, NAME_MAP }, null, 2),
);

console.log(`Wrote ${OUT}`);
console.log(`DATA: ${(DATA as unknown[]).length} projects`);
console.log(`COMP_COORDS: ${Object.keys(COMP_COORDS as object).length} entries`);
console.log(`BSTATS: ${Object.keys(BSTATS as object).length} buildings`);
console.log(`AGG.ut_stats: ${Object.keys(AGG.ut_stats).length} unit types`);
console.log(`AGG.pt_ut_stats: ${Object.keys(AGG.pt_ut_stats).length} property types`);
console.log(`AGG.trend: ${Object.keys(AGG.trend).length} quarters`);
console.log(`NAME_MAP: ${Object.keys(NAME_MAP as object).length} entries`);
