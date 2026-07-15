import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "propertyType", label: "Property Type", type: "text", width: "9.0%", placeholder: "Conversion / Primary / Market" },
  { key: "unitType", label: "Unit Type", type: "text", width: "7.9%" },
  { key: "avgRent", label: "Avg Rent", type: "number", width: "7.9%" },
  { key: "medRent", label: "Med Rent", type: "number", width: "7.9%" },
  { key: "minRent", label: "Min Rent", type: "number", width: "7.9%" },
  { key: "maxRent", label: "Max Rent", type: "number", width: "7.9%" },
  { key: "nRent", label: "n (rent)", type: "number", width: "6.1%" },
  { key: "avgPsf", label: "Avg $/SF", type: "number", width: "7.9%" },
  { key: "medPsf", label: "Med $/SF", type: "number", width: "7.9%" },
  { key: "minPsf", label: "Min $/SF", type: "number", width: "7.9%" },
  { key: "maxPsf", label: "Max $/SF", type: "number", width: "7.9%" },
  { key: "nPsf", label: "n ($/SF)", type: "number", width: "6.1%" },
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
      <EditableTable columns={COLUMNS} apiBase="/api/type-stats" initialRows={rows} emptyRow={EMPTY_ROW} resource="type-stats" />
    </div>
  );
}
