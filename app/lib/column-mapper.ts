import type { Resource } from "./sync-resources";

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const RESOURCE_FIELDS: Record<Resource, FieldDef[]> = {
  projects: [
    { key: "name", label: "Name", required: true, aliases: ["name", "project name", "project", "building", "building name", "address"] },
    { key: "borough", label: "Borough", required: false, aliases: ["borough", "neighborhood", "boro", "location"] },
    { key: "status", label: "Status", required: false, aliases: ["status", "project status", "stage"] },
    { key: "category", label: "Category", required: false, aliases: ["category", "type", "project type"] },
    { key: "units", label: "Units", required: false, aliases: ["units", "total units", "unit count", "# units", "num units"] },
    { key: "sqft", label: "Sq Ft", required: false, aliases: ["sqft", "sq ft", "square feet", "sf", "gross sf", "gsf", "area"] },
    { key: "deliveryLabel", label: "Delivery Label", required: false, aliases: ["deliverylabel", "delivery label", "delivery", "delivery date", "est. delivery", "expected delivery"] },
    { key: "sponsor", label: "Sponsor", required: false, aliases: ["sponsor", "developer", "developer name", "owner", "entity"] },
    { key: "lender", label: "Lender", required: false, aliases: ["lender", "bank", "lender name", "financing"] },
    { key: "lat", label: "Latitude", required: false, aliases: ["lat", "latitude", "y"] },
    { key: "lng", label: "Longitude", required: false, aliases: ["lng", "lon", "longitude", "x"] },
    { key: "isRudin", label: "Is Rudin?", required: false, aliases: ["isrudin", "is rudin", "rudin", "rudin property"] },
    { key: "imageUrl", label: "Image URL", required: false, aliases: ["imageurl", "image url", "image", "img", "photo url"] },
    { key: "affPct", label: "Affordable %", required: false, aliases: ["affpct", "aff pct", "aff %", "affordable %", "affordable pct", "affordable percent"] },
    { key: "mktU", label: "Market Units", required: false, aliases: ["mktu", "mkt u", "market units", "market rate units"] },
    { key: "affU", label: "Affordable Units", required: false, aliases: ["affu", "aff u", "affordable units", "aff units"] },
    { key: "avgSf", label: "Avg SF/Unit", required: false, aliases: ["avgsf", "avg sf", "avg sf/unit", "avg sq ft", "average sf"] },
    { key: "compBuildingName", label: "Comp Building Name", required: false, aliases: ["compbuildingname", "comp building", "comp building name", "comp"] },
  ],
  "comp-buildings": [
    { key: "name", label: "Building Name", required: true, aliases: ["name", "building name", "building", "property", "property name", "address", "bldg", "bldg name"] },
    { key: "propertyType", label: "Property Type", required: false, aliases: ["propertytype", "property type", "type", "classification", "class", "bldg type", "category"] },
    { key: "lat", label: "Latitude", required: false, aliases: ["lat", "latitude", "y"] },
    { key: "lng", label: "Longitude", required: false, aliases: ["lng", "lon", "longitude", "x"] },
    { key: "underwritten", label: "Underwritten", required: false, aliases: ["underwritten", "uw", "uw?", "is underwritten"] },
    { key: "note", label: "Note", required: false, aliases: ["note", "notes", "comment", "comments", "description", "remarks"] },
    { key: "totalN", label: "Total Leases (n)", required: false, aliases: ["totaln", "total n", "total leases", "n", "count", "total count", "lease count", "total"] },
  ],
  "comp-building-stats": [
    { key: "buildingName", label: "Building Name", required: true, aliases: ["buildingname", "building name", "building", "property", "property name", "address", "bldg", "bldg name"] },
    { key: "unitType", label: "Unit Type", required: true, aliases: ["unittype", "unit type", "bed type", "bedroom type", "unit size", "apt type", "bedroom", "beds", "bedrooms"] },
    { key: "avgRent", label: "Avg Rent", required: false, aliases: ["avgrent", "avg rent", "average rent", "avg. rent", "mean rent", "avg rent ($)", "average rental", "rent avg"] },
    { key: "medRent", label: "Median Rent", required: false, aliases: ["medrent", "med rent", "median rent", "med. rent", "median"] },
    { key: "minRent", label: "Min Rent", required: false, aliases: ["minrent", "min rent", "minimum rent", "min. rent", "rent min"] },
    { key: "maxRent", label: "Max Rent", required: false, aliases: ["maxrent", "max rent", "maximum rent", "max. rent", "rent max"] },
    { key: "nRent", label: "Rent n", required: false, aliases: ["nrent", "n rent", "n (rent)", "rent count", "rent n", "# leases"] },
    { key: "avgPsf", label: "Avg $/SF", required: false, aliases: ["avgpsf", "avg psf", "average psf", "avg $/sf", "avg$/sf", "$/sf avg", "price per sf", "avg price/sf"] },
    { key: "medPsf", label: "Median $/SF", required: false, aliases: ["medpsf", "med psf", "median psf", "med $/sf"] },
    { key: "minPsf", label: "Min $/SF", required: false, aliases: ["minpsf", "min psf", "minimum psf", "min $/sf"] },
    { key: "maxPsf", label: "Max $/SF", required: false, aliases: ["maxpsf", "max psf", "maximum psf", "max $/sf"] },
    { key: "nPsf", label: "$/SF n", required: false, aliases: ["npsf", "n psf", "psf count", "psf n"] },
    { key: "avgSf", label: "Avg SF", required: false, aliases: ["avgsf", "avg sf", "average sf", "avg sq ft", "sf avg"] },
    { key: "medSf", label: "Median SF", required: false, aliases: ["medsf", "med sf", "median sf"] },
    { key: "minSf", label: "Min SF", required: false, aliases: ["minsf", "min sf", "minimum sf"] },
    { key: "maxSf", label: "Max SF", required: false, aliases: ["maxsf", "max sf", "maximum sf"] },
    { key: "nSf", label: "SF n", required: false, aliases: ["nsf", "n sf", "sf count"] },
  ],
  "comp-building-quarter-stats": [
    { key: "buildingName", label: "Building Name", required: true, aliases: ["buildingname", "building name", "building", "property", "property name", "address", "bldg"] },
    { key: "quarter", label: "Quarter", required: true, aliases: ["quarter", "qtr", "q", "period", "time period", "date", "quarter label"] },
    { key: "quarterOrder", label: "Quarter Order", required: false, aliases: ["quarterorder", "quarter order", "order", "sort order", "qtr order", "quarter #"] },
    { key: "unitType", label: "Unit Type", required: true, aliases: ["unittype", "unit type", "bed type", "bedroom type", "unit size", "apt type", "beds", "bedrooms"] },
    { key: "avgRent", label: "Avg Rent", required: false, aliases: ["avgrent", "avg rent", "average rent", "avg. rent", "mean rent", "avg rent ($)"] },
    { key: "avgPsf", label: "Avg $/SF", required: false, aliases: ["avgpsf", "avg psf", "average psf", "avg $/sf", "avg$/sf", "$/sf avg"] },
    { key: "n", label: "n (leases)", required: false, aliases: ["n", "count", "lease count", "# leases", "leases", "total", "n leases"] },
  ],
  "overall-stats": [
    { key: "unitType", label: "Unit Type", required: true, aliases: ["unittype", "unit type", "bed type", "bedroom type", "type", "bedroom", "beds", "bedrooms"] },
    { key: "avgRent", label: "Avg Rent", required: false, aliases: ["avgrent", "avg rent", "average rent", "avg. rent", "mean rent"] },
    { key: "medRent", label: "Median Rent", required: false, aliases: ["medrent", "med rent", "median rent"] },
    { key: "minRent", label: "Min Rent", required: false, aliases: ["minrent", "min rent", "minimum rent"] },
    { key: "maxRent", label: "Max Rent", required: false, aliases: ["maxrent", "max rent", "maximum rent"] },
    { key: "nRent", label: "Rent n", required: false, aliases: ["nrent", "n rent", "rent count"] },
    { key: "avgPsf", label: "Avg $/SF", required: false, aliases: ["avgpsf", "avg psf", "average psf", "avg $/sf"] },
    { key: "medPsf", label: "Median $/SF", required: false, aliases: ["medpsf", "med psf", "median psf"] },
    { key: "minPsf", label: "Min $/SF", required: false, aliases: ["minpsf", "min psf", "minimum psf"] },
    { key: "maxPsf", label: "Max $/SF", required: false, aliases: ["maxpsf", "max psf", "maximum psf"] },
    { key: "nPsf", label: "$/SF n", required: false, aliases: ["npsf", "n psf", "psf count"] },
    { key: "avgSf", label: "Avg SF", required: false, aliases: ["avgsf", "avg sf", "average sf"] },
    { key: "medSf", label: "Median SF", required: false, aliases: ["medsf", "med sf", "median sf"] },
    { key: "minSf", label: "Min SF", required: false, aliases: ["minsf", "min sf", "minimum sf"] },
    { key: "maxSf", label: "Max SF", required: false, aliases: ["maxsf", "max sf", "maximum sf"] },
    { key: "nSf", label: "SF n", required: false, aliases: ["nsf", "n sf", "sf count"] },
  ],
  "type-stats": [
    { key: "propertyType", label: "Property Type", required: true, aliases: ["propertytype", "property type", "type", "classification", "class"] },
    { key: "unitType", label: "Unit Type", required: true, aliases: ["unittype", "unit type", "bed type", "bedroom", "beds", "bedrooms"] },
    { key: "avgRent", label: "Avg Rent", required: false, aliases: ["avgrent", "avg rent", "average rent", "avg. rent", "mean rent"] },
    { key: "medRent", label: "Median Rent", required: false, aliases: ["medrent", "med rent", "median rent"] },
    { key: "minRent", label: "Min Rent", required: false, aliases: ["minrent", "min rent", "minimum rent"] },
    { key: "maxRent", label: "Max Rent", required: false, aliases: ["maxrent", "max rent", "maximum rent"] },
    { key: "nRent", label: "Rent n", required: false, aliases: ["nrent", "n rent", "rent count"] },
    { key: "avgPsf", label: "Avg $/SF", required: false, aliases: ["avgpsf", "avg psf", "average psf", "avg $/sf"] },
    { key: "medPsf", label: "Median $/SF", required: false, aliases: ["medpsf", "med psf", "median psf"] },
    { key: "minPsf", label: "Min $/SF", required: false, aliases: ["minpsf", "min psf", "minimum psf"] },
    { key: "maxPsf", label: "Max $/SF", required: false, aliases: ["maxpsf", "max psf", "maximum psf"] },
    { key: "nPsf", label: "$/SF n", required: false, aliases: ["npsf", "n psf", "psf count"] },
  ],
  trend: [
    { key: "quarter", label: "Quarter", required: true, aliases: ["quarter", "qtr", "q", "period", "time period", "date"] },
    { key: "quarterOrder", label: "Quarter Order", required: false, aliases: ["quarterorder", "quarter order", "order", "sort order", "qtr order"] },
    { key: "unitType", label: "Unit Type", required: true, aliases: ["unittype", "unit type", "bed type", "bedroom", "beds", "bedrooms"] },
    { key: "avgRent", label: "Avg Rent", required: false, aliases: ["avgrent", "avg rent", "average rent", "avg. rent", "mean rent"] },
    { key: "avgPsf", label: "Avg $/SF", required: false, aliases: ["avgpsf", "avg psf", "average psf", "avg $/sf"] },
  ],
  // Individual lease transaction records — matches Rudin workbook "Data" sheet format
  "lease-comps": [
    { key: "building", label: "Building", required: true, aliases: ["building", "building name", "property", "property name", "bldg", "address", "comp building"] },
    { key: "unit", label: "Unit", required: false, aliases: ["unit", "unit id", "unit number", "unit no", "unit #", "apt", "apt #", "apartment", "suite", "residence", "#"] },
    { key: "unitType", label: "Unit Type", required: false, aliases: ["unit type", "unittype", "bed type", "bedroom type", "unit size", "apt type", "bedroom", "beds", "bedrooms", "floorplan", "floorplan name", "floorplan type", "plan type", "plan"] },
    { key: "unitSf", label: "Unit SF", required: false, aliases: ["unit sf", "unitsf", "sqft", "sq ft", "square feet", "sf", "unit sqft", "size sf", "net sf", "area sf", "size", "area"] },
    { key: "grossRent", label: "Gross Rent", required: false, aliases: ["gross rent", "grossrent", "rent", "asking rent", "gross monthly rent", "monthly rent", "gross", "listed rent", "advertised rent"] },
    { key: "grossPsf", label: "Gross $/SF", required: false, aliases: ["gross $/sf", "grosspsf", "gross/sf", "asking psf", "asking $/sf", "psf", "rent psf", "$/sf", "price per sf", "rent per sf", "list psf", "advertised psf"] },
    { key: "netRent", label: "Net Rent", required: false, aliases: ["net rent", "netrent", "net monthly rent", "effective rent", "net effective rent", "net", "effective", "net asking rent"] },
    { key: "concession", label: "Concession", required: false, aliases: ["concession", "concession months", "free months", "concessions", "free rent", "months free"] },
    { key: "leaseDate", label: "Date", required: false, aliases: ["date", "lease date", "leased date", "signed date", "commencement", "start date", "lease start", "executed", "first listed", "listing date", "listed date", "available date"] },
    { key: "quarter", label: "Quarter", required: false, aliases: ["quarter", "qtr", "fiscal quarter", "period", "time period"] },
    { key: "propertyType", label: "Property Type", required: false, aliases: ["property type", "propertytype", "building type", "conversion type", "class", "category"] },
  ],
};

export const RESOURCE_LABELS: Record<Resource, string> = {
  projects: "Pipeline Projects",
  "comp-buildings": "Comp Buildings",
  "comp-building-stats": "Comp Building Stats",
  "comp-building-quarter-stats": "Comp Building Quarter Stats",
  "overall-stats": "Overall Unit Stats",
  "type-stats": "Type × Unit Stats",
  trend: "Rent Trend",
  "lease-comps": "Lease Comp Records",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Levenshtein edit distance
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Returns a match score for (header, alias) pair — higher is better, 0 means no match
function matchScore(header: string, alias: string): number {
  const h = normalize(header);
  const a = normalize(alias);
  if (!h || !a) return 0;

  // Exact match
  if (h === a) return 100;

  // Header contains alias (e.g. "monthly gross rent ($)" contains "gross rent")
  // Only allow alias-in-header when alias is at least 5 chars to avoid short alias ("unit", "sf") false-positives
  if (a.length >= 5 && h.includes(a)) return 80;
  // Alias contains header (e.g. alias "property name" contains header "property")
  if (h.length >= 5 && a.includes(h)) return 75;

  // Token overlap: what fraction of alias tokens appear in header tokens
  const hTokens = new Set(h.split(" "));
  const aTokens = a.split(" ");
  const overlap = aTokens.filter((t) => hTokens.has(t)).length;
  if (overlap > 0) {
    const ratio = overlap / Math.max(hTokens.size, aTokens.length);
    if (ratio >= 0.5) return Math.round(60 * ratio);
  }

  // Fuzzy: allow small edit distance proportional to length
  const maxLen = Math.max(h.length, a.length);
  const dist = editDistance(h, a);
  const tolerance = maxLen <= 5 ? 1 : maxLen <= 10 ? 2 : 3;
  if (dist <= tolerance) return Math.round(40 * (1 - dist / maxLen));

  return 0;
}

// Best score for a header against all aliases of a field
function fieldScore(header: string, field: FieldDef): number {
  return Math.max(0, ...field.aliases.map((a) => matchScore(header, a)));
}

const MATCH_THRESHOLD = 30; // minimum score to accept a mapping

export function autoMapColumns(headers: string[], resource: Resource): Record<string, string | null> {
  const fields = RESOURCE_FIELDS[resource];
  // Score every (header, field) pair
  const scores: { header: string; field: FieldDef; score: number }[] = [];
  for (const header of headers) {
    for (const field of fields) {
      const score = fieldScore(header, field);
      if (score >= MATCH_THRESHOLD) scores.push({ header, field, score });
    }
  }
  // Greedy assignment: highest-score pairs first, no reuse of header or field
  scores.sort((a, b) => b.score - a.score);
  const usedHeaders = new Set<string>();
  const usedFields = new Set<string>();
  const result: Record<string, string | null> = Object.fromEntries(headers.map((h) => [h, null]));
  for (const { header, field, score: _score } of scores) {
    if (usedHeaders.has(header) || usedFields.has(field.key)) continue;
    result[header] = field.key;
    usedHeaders.add(header);
    usedFields.add(field.key);
  }
  return result;
}

export function detectResource(headers: string[]): { resource: Resource; score: number } | null {
  const resources = Object.keys(RESOURCE_FIELDS) as Resource[];
  let best: { resource: Resource; score: number } | null = null;
  for (const resource of resources) {
    const fields = RESOURCE_FIELDS[resource];
    const mapping = autoMapColumns(headers, resource);
    const matched = Object.values(mapping).filter(Boolean).length;
    const requiredMatched = Object.values(mapping).filter((v) => {
      if (!v) return false;
      return fields.find((f) => f.key === v)?.required;
    }).length;
    const totalRequired = fields.filter((f) => f.required).length;
    // Penalise resources that have required fields we couldn't satisfy
    const missedRequired = totalRequired - requiredMatched;
    // Coverage ratio: fraction of this resource's fields that were matched
    const coverage = matched / fields.length;
    const score = requiredMatched * 8 - missedRequired * 6 + matched * 2 + coverage * 10;
    if (!best || score > best.score) best = { resource, score };
  }
  return best;
}
