import { prisma } from "@/app/lib/prisma";
import EditableTable, { Column, Row } from "../components/EditableTable";

export const dynamic = "force-dynamic";

export default async function CompBuildingStatsAdminPage() {
  const [stats, buildings] = await Promise.all([
    prisma.compBuildingStat.findMany({ include: { building: { select: { name: true } } } }),
    prisma.compBuilding.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.name }));

  const columns: Column[] = [
    { key: "buildingId", label: "Building", type: "select", options: buildingOptions, width: "11.0%" },
    { key: "unitType", label: "Unit Type", type: "text", width: "5.3%", placeholder: "ST / 1BD / 2BD…" },
    { key: "avgRent", label: "Avg Rent", type: "number", width: "5.3%" },
    { key: "medRent", label: "Med Rent", type: "number", width: "5.3%" },
    { key: "minRent", label: "Min Rent", type: "number", width: "5.3%" },
    { key: "maxRent", label: "Max Rent", type: "number", width: "5.3%" },
    { key: "nRent", label: "n (rent)", type: "number", width: "4.1%" },
    { key: "avgPsf", label: "Avg $/SF", type: "number", width: "5.3%" },
    { key: "medPsf", label: "Med $/SF", type: "number", width: "5.3%" },
    { key: "minPsf", label: "Min $/SF", type: "number", width: "5.3%" },
    { key: "maxPsf", label: "Max $/SF", type: "number", width: "5.3%" },
    { key: "nPsf", label: "n ($/SF)", type: "number", width: "4.1%" },
    { key: "avgSf", label: "Avg SF", type: "number", width: "5.3%" },
    { key: "medSf", label: "Med SF", type: "number", width: "5.3%" },
    { key: "minSf", label: "Min SF", type: "number", width: "5.3%" },
    { key: "maxSf", label: "Max SF", type: "number", width: "5.3%" },
    { key: "nSf", label: "n (SF)", type: "number", width: "4.1%" },
  ];

  const emptyRow: Row = {
    buildingId: buildingOptions[0]?.value ?? "",
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

  const rows: Row[] = stats.map((s) => ({
    id: s.id,
    buildingId: s.buildingId,
    unitType: s.unitType,
    avgRent: s.avgRent,
    medRent: s.medRent,
    minRent: s.minRent,
    maxRent: s.maxRent,
    nRent: s.nRent,
    avgPsf: s.avgPsf,
    medPsf: s.medPsf,
    minPsf: s.minPsf,
    maxPsf: s.maxPsf,
    nPsf: s.nPsf,
    avgSf: s.avgSf,
    medSf: s.medSf,
    minSf: s.minSf,
    maxSf: s.maxSf,
    nSf: s.nSf,
  }));

  return (
    <div>
      <h1>Comp Building Stats</h1>
      <p className="admin-sub">
        Per unit-type rent/SF/PSF stats for each comp building, powering the &quot;By Building&quot; tab. One row per
        building + unit type.
      </p>
      {buildingOptions.length === 0 && <p className="admin-error">Add a Comp Building first.</p>}
      <EditableTable columns={columns} apiBase="/api/comp-building-stats" initialRows={rows} emptyRow={emptyRow} resource="comp-building-stats" />
    </div>
  );
}
