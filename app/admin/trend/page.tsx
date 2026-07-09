import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "quarter", label: "Quarter", type: "text", width: "82px", placeholder: "Q3 2024" },
  { key: "quarterOrder", label: "Sort Order", type: "number", width: "72px", placeholder: "e.g. 20243" },
  { key: "unitType", label: "Unit Type", type: "text", width: "72px" },
  { key: "avgRent", label: "Avg Rent", type: "number", width: "72px" },
  { key: "avgPsf", label: "Avg $/SF", type: "number", width: "72px" },
];

const EMPTY_ROW: Row = {
  quarter: "",
  quarterOrder: 0,
  unitType: "",
  avgRent: 0,
  avgPsf: null,
};

export default async function TrendAdminPage() {
  const points = await prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } });
  const rows: Row[] = points.map((p) => ({ ...p }));

  return (
    <div>
      <h1>Rent Trend</h1>
      <p className="admin-sub">
        Quarterly average rent by unit type, powering the &quot;Trend&quot; chart. Sort Order should increase
        chronologically (e.g. year×10 + quarter number, so Q3 2024 = 20243).
      </p>
      <EditableTable columns={COLUMNS} apiBase="/api/trend" initialRows={rows} emptyRow={EMPTY_ROW} />
    </div>
  );
}
