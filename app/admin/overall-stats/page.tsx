import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "unitType", label: "Unit Type", type: "text", width: "6.0%" },
  { key: "avgRent", label: "Avg Rent", type: "number", width: "6.0%" },
  { key: "medRent", label: "Med Rent", type: "number", width: "6.0%" },
  { key: "minRent", label: "Min Rent", type: "number", width: "6.0%" },
  { key: "maxRent", label: "Max Rent", type: "number", width: "6.0%" },
  { key: "nRent", label: "n (rent)", type: "number", width: "4.7%" },
  { key: "avgPsf", label: "Avg $/SF", type: "number", width: "6.0%" },
  { key: "medPsf", label: "Med $/SF", type: "number", width: "6.0%" },
  { key: "minPsf", label: "Min $/SF", type: "number", width: "6.0%" },
  { key: "maxPsf", label: "Max $/SF", type: "number", width: "6.0%" },
  { key: "nPsf", label: "n ($/SF)", type: "number", width: "4.7%" },
  { key: "avgSf", label: "Avg SF", type: "number", width: "6.0%" },
  { key: "medSf", label: "Med SF", type: "number", width: "6.0%" },
  { key: "minSf", label: "Min SF", type: "number", width: "6.0%" },
  { key: "maxSf", label: "Max SF", type: "number", width: "6.0%" },
  { key: "nSf", label: "n (SF)", type: "number", width: "4.7%" },
];

const EMPTY_ROW: Row = {
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
  avgSf: null,
  medSf: null,
  minSf: null,
  maxSf: null,
  nSf: null,
};

export default async function OverallStatsAdminPage() {
  const stats = await prisma.overallUnitStat.findMany();
  const rows: Row[] = stats.map((s) => ({ ...s }));

  return (
    <div>
      <h1>Overall Unit Stats</h1>
      <p className="admin-sub">
        Market-wide averages by unit type (all comp buildings combined) — powers the &quot;Overview&quot; tab summary
        cards.
      </p>
      <EditableTable columns={COLUMNS} apiBase="/api/overall-stats" initialRows={rows} emptyRow={EMPTY_ROW} />
    </div>
  );
}
