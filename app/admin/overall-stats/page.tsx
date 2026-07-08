import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "unitType", label: "Unit Type", type: "text", width: "90px" },
  { key: "avgRent", label: "Avg Rent", type: "number", width: "90px" },
  { key: "medRent", label: "Med Rent", type: "number", width: "90px" },
  { key: "minRent", label: "Min Rent", type: "number", width: "90px" },
  { key: "maxRent", label: "Max Rent", type: "number", width: "90px" },
  { key: "nRent", label: "n (rent)", type: "number", width: "70px" },
  { key: "avgPsf", label: "Avg $/SF", type: "number", width: "90px" },
  { key: "medPsf", label: "Med $/SF", type: "number", width: "90px" },
  { key: "minPsf", label: "Min $/SF", type: "number", width: "90px" },
  { key: "maxPsf", label: "Max $/SF", type: "number", width: "90px" },
  { key: "nPsf", label: "n ($/SF)", type: "number", width: "70px" },
  { key: "avgSf", label: "Avg SF", type: "number", width: "90px" },
  { key: "medSf", label: "Med SF", type: "number", width: "90px" },
  { key: "minSf", label: "Min SF", type: "number", width: "90px" },
  { key: "maxSf", label: "Max SF", type: "number", width: "90px" },
  { key: "nSf", label: "n (SF)", type: "number", width: "70px" },
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
