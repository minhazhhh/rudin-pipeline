import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";
import GeocodeButton from "./GeocodeButton";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "name", label: "Name", type: "text", width: "7.5%" },
  { key: "borough", label: "Borough", type: "text", width: "4.2%", placeholder: "Manhattan" },
  { key: "status", label: "Status", type: "text", width: "5.5%", placeholder: "Under Construction" },
  { key: "category", label: "Category", type: "text", width: "5.5%", placeholder: "Office-to-Residential" },
  { key: "units", label: "Units", type: "number", width: "3.2%" },
  { key: "sqft", label: "SF", type: "number", width: "4.2%" },
  { key: "deliveryLabel", label: "Delivery", type: "text", width: "3.8%", placeholder: "2027 / TBD" },
  { key: "sponsor", label: "Sponsor", type: "text", width: "6.0%" },
  { key: "lender", label: "Lender", type: "text", width: "6.0%" },
  { key: "lat", label: "Lat", type: "number", width: "4.0%" },
  { key: "lng", label: "Lng", type: "number", width: "4.0%" },
  { key: "isRudin", label: "Rudin", type: "boolean", width: "2.4%" },
  { key: "imageUrl", label: "Image URL", type: "text", width: "7.5%" },
  { key: "affPct", label: "Aff %", type: "number", width: "3.0%" },
  { key: "mktU", label: "Mkt Units", type: "number", width: "3.4%" },
  { key: "affU", label: "Aff Units", type: "number", width: "3.4%" },
  { key: "avgSf", label: "Avg SF", type: "number", width: "3.4%" },
  {
    key: "affBands",
    label: "Aff Bands (JSON)",
    type: "json",
    width: "8.5%",
    placeholder: "optional — leave blank unless this project has an affordability breakdown",
  },
  { key: "compBuildingName", label: "Comp Building", type: "text", width: "6.5%", placeholder: "links to Comp Buildings by name" },
];

const EMPTY_ROW: Row = {
  name: "",
  borough: "Manhattan",
  status: "Potential Conversion",
  category: "Office-to-Residential",
  units: null,
  sqft: null,
  deliveryLabel: "TBD",
  sponsor: "",
  lender: "",
  lat: 40.75,
  lng: -73.98,
  isRudin: false,
  imageUrl: "",
  affPct: null,
  mktU: null,
  affU: null,
  avgSf: null,
  affBands: null,
  compBuildingName: null,
};

export default async function ProjectsAdminPage() {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
  const rows: Row[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    borough: p.borough,
    status: p.status,
    category: p.category,
    units: p.units,
    sqft: p.sqft,
    deliveryLabel: p.deliveryLabel,
    sponsor: p.sponsor,
    lender: p.lender,
    lat: p.lat,
    lng: p.lng,
    isRudin: p.isRudin,
    imageUrl: p.imageUrl,
    affPct: p.affPct,
    mktU: p.mktU,
    affU: p.affU,
    avgSf: p.avgSf,
    affBands: p.affBands,
    compBuildingName: p.compBuildingName,
  }));

  const missingCoords = projects.filter((p) => !p.lat && !p.lng || (p.lat === 0 && p.lng === 0)).length;

  return (
    <div>
      <h1>Pipeline Projects</h1>
      <p className="admin-sub">
        The buildings shown on the public map + list. Edits save immediately per row. Bulk updates can also be pulled
        from a Google Sheet — see Sheet Sync.
      </p>
      {missingCoords > 0 && (
        <GeocodeButton missingCount={missingCoords} />
      )}
      <EditableTable columns={COLUMNS} apiBase="/api/projects" initialRows={rows} emptyRow={EMPTY_ROW} />
    </div>
  );
}
