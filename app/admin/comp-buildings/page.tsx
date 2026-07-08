import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "name", label: "Name", type: "text", width: "200px" },
  { key: "propertyType", label: "Property Type", type: "text", width: "130px", placeholder: "Conversion / Primary / Market" },
  { key: "lat", label: "Lat", type: "number", width: "100px" },
  { key: "lng", label: "Lng", type: "number", width: "100px" },
  { key: "underwritten", label: "Underwritten", type: "boolean", width: "60px" },
  { key: "note", label: "Note", type: "text", width: "220px" },
  { key: "totalN", label: "Total Leases (n)", type: "number", width: "90px" },
];

const EMPTY_ROW: Row = {
  name: "",
  propertyType: "Market",
  lat: null,
  lng: null,
  underwritten: false,
  note: "",
  totalN: null,
};

export default async function CompBuildingsAdminPage() {
  const buildings = await prisma.compBuilding.findMany({ orderBy: { name: "asc" } });
  const rows: Row[] = buildings.map((b) => ({
    id: b.id,
    name: b.name,
    propertyType: b.propertyType,
    lat: b.lat,
    lng: b.lng,
    underwritten: b.underwritten,
    note: b.note,
    totalN: b.totalN,
  }));

  return (
    <div>
      <h1>Comp Buildings</h1>
      <p className="admin-sub">
        The set of comparable rental buildings used in the Rent Comparables tab. Add a building here first, then add
        its per-unit-type stats on the Comp Building Stats page.
      </p>
      <EditableTable columns={COLUMNS} apiBase="/api/comp-buildings" initialRows={rows} emptyRow={EMPTY_ROW} />
    </div>
  );
}
