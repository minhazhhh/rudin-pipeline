import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "propertyType", label: "Property Type", type: "text", width: "82px", placeholder: "Conversion / Primary / Market" },
  { key: "unitType", label: "Unit Type", type: "text", width: "72px" },
  { key: "avgRent", label: "Avg Rent", type: "number", width: "72px" },
  { key: "medRent", label: "Med Rent", type: "number", width: "72px" },
  { key: "minRent", label: "Min Rent", type: "number", width: "72px" },
  { key: "maxRent", label: "Max Rent", type: "number", width: "72px" },
  { key: "nRent", label: "n (rent)", type: "number", width: "56px" },
  { key: "avgPsf", label: "Avg $/SF", type: "number", width: "72px" },
  { key: "medPsf", label: "Med $/SF", type: "number", width: "72px" },
  { key: "minPsf", label: "Min $/SF", type: "number", width: "72px" },
  { key: "maxPsf", label: "Max $/SF", type: "number", width: "72px" },
  { key: "nPsf", label: "n ($/SF)", type: "number", width: "56px" },
];

const EMPTY_ROW: Row = {
  propertyType: "Conversion",
  unitType: "",
  avgRent: null,
  medRent: null,
  minRent: null,
  maxRent: null,
  nRent: null,
  avgPsf: null,
  medPsf: null,
  minPsf: null,
  maxPsf: null,
  nPsf: null,
};

export default async function TypeStatsAdminPage() {
  const stats = await prisma.typeUnitStat.findMany();
  const rows: Row[] = stats.map((s) => ({ ...s }));

  return (
    <div>
      <h1>Type × Unit Stats</h1>
      <p className="admin-sub">
        Averages broken out by property type (Conversion / Primary / Market) × unit type — powers the &quot;By
        Property Type&quot; tab.
      </p>
      <EditableTable columns={COLUMNS} apiBase="/api/type-stats" initialRows={rows} emptyRow={EMPTY_ROW} />
    </div>
  );
}
