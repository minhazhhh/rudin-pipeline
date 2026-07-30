import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/app/lib/prisma";
import BuildingTable from "./BuildingTable";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  return { title: `${name} — Unit Data` };
}

export default async function BuildingPage({ params }: Props) {
  const { slug } = await params;
  const name = decodeURIComponent(slug);

  const building = await prisma.compBuilding.findUnique({
    where: { name },
    include: {
      units: { orderBy: [{ unitType: "asc" }, { floor: "asc" }, { unitName: "asc" }] },
      stats: { orderBy: { unitType: "asc" } },
      quarterStats: { orderBy: { quarterOrder: "asc" } },
    },
  });

  if (!building) notFound();

  const unitCount = building.units.length;
  const quarters = [...new Set(building.quarterStats.map((q) => q.quarter))].sort(
    (a, b) => {
      const aq = building.quarterStats.find((s) => s.quarter === a)?.quarterOrder ?? 0;
      const bq = building.quarterStats.find((s) => s.quarter === b)?.quarterOrder ?? 0;
      return aq - bq;
    }
  );

  const unitTypes = [...new Set(building.stats.map((s) => s.unitType))];

  function fmtRent(n: number | null) {
    return n == null ? "—" : "$" + Math.round(n).toLocaleString();
  }
  function fmtN(n: number | null) {
    return n == null ? "—" : n.toLocaleString();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f6f8f6", fontFamily: "'Inter', 'Basis Grotesque', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1a2e24", color: "#fff", padding: "18px 32px", display: "flex", alignItems: "center", gap: 24, borderBottom: "1px solid #2a4a34" }}>
        <Link href="/" style={{ color: "#7ab89a", fontSize: 13, textDecoration: "none", flexShrink: 0 }}>
          ← Dashboard
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em", color: "#e8f4e8", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {building.name}
          </div>
          <div style={{ fontSize: 12, color: "#7ab89a", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{building.propertyType}</span>
            {building.totalN != null && <span>{building.totalN.toLocaleString()} total leases on record</span>}
            {building.underwritten && <span style={{ color: "#86efac", fontWeight: 600 }}>✓ Underwritten</span>}
            {building.note && <span style={{ color: "#a8c8a0" }}>{building.note}</span>}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#7ab89a", textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#e8f4e8" }}>{unitCount.toLocaleString()}</div>
          <div>unit records</div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px" }}>
        {/* All-time stats table */}
        {building.stats.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#7a9a8a", marginBottom: 10 }}>
              All-Time Aggregates (from comp-building-stats)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, background: "#fff", borderRadius: 4, border: "1px solid #d4e4d4" }}>
                <thead>
                  <tr style={{ background: "#f4f6f4" }}>
                    {["Type", "n", "Avg Rent", "Med Rent", "Min", "Max", "Avg $/SF", "Avg SF"].map((h) => (
                      <th key={h} style={{ padding: "7px 14px", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: .5, color: "#5a7a68", borderBottom: "1.5px solid #d4e4d4", textAlign: h === "Type" ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {building.stats.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #eef2ee" }}>
                      <td style={{ padding: "7px 14px", fontWeight: 700 }}>{s.unitType}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", color: "#6b7b75" }}>{fmtN(s.nRent)}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontWeight: 600 }}>{fmtRent(s.avgRent)}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right" }}>{fmtRent(s.medRent)}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", color: "#6b7b75" }}>{fmtRent(s.minRent)}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", color: "#6b7b75" }}>{fmtRent(s.maxRent)}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right" }}>{s.avgPsf != null ? "$" + s.avgPsf.toFixed(2) : "—"}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right" }}>{s.avgSf != null ? Math.round(s.avgSf).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quarterly trend table */}
        {quarters.length > 0 && unitTypes.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#7a9a8a", marginBottom: 10 }}>
              Quarterly History
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, background: "#fff", borderRadius: 4, border: "1px solid #d4e4d4", minWidth: 400 }}>
                <thead>
                  <tr style={{ background: "#f4f6f4" }}>
                    <th style={{ padding: "7px 14px", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: .5, color: "#5a7a68", borderBottom: "1.5px solid #d4e4d4", textAlign: "left" }}>Quarter</th>
                    {unitTypes.map((t) => (
                      <th key={t} colSpan={2} style={{ padding: "7px 14px", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: .5, color: "#5a7a68", borderBottom: "1.5px solid #d4e4d4", textAlign: "center", borderLeft: "1px solid #eef2ee" }}>{t}</th>
                    ))}
                  </tr>
                  <tr style={{ background: "#f9fbf9" }}>
                    <th style={{ padding: "5px 14px", borderBottom: "1px solid #d4e4d4" }}></th>
                    {unitTypes.map((t) => (
                      <>
                        <th key={t + "-r"} style={{ padding: "5px 10px", fontSize: 9, color: "#7a9a8a", fontWeight: 600, textAlign: "right", borderBottom: "1px solid #d4e4d4", borderLeft: "1px solid #eef2ee" }}>Avg Rent</th>
                        <th key={t + "-n"} style={{ padding: "5px 10px", fontSize: 9, color: "#7a9a8a", fontWeight: 600, textAlign: "right", borderBottom: "1px solid #d4e4d4" }}>n</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quarters.map((q, qi) => {
                    const rowStats = building.quarterStats.filter((s) => s.quarter === q);
                    return (
                      <tr key={q} style={{ background: qi % 2 === 0 ? "#fff" : "#f9fbf9", borderBottom: "1px solid #eef2ee" }}>
                        <td style={{ padding: "6px 14px", fontWeight: 600, fontSize: 12, color: "#3a4a42", whiteSpace: "nowrap" }}>{q}</td>
                        {unitTypes.map((t) => {
                          const s = rowStats.find((r) => r.unitType === t);
                          return (
                            <>
                              <td key={t + "-r"} style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#1e3a2a", borderLeft: "1px solid #eef2ee" }}>{s ? fmtRent(s.avgRent) : "—"}</td>
                              <td key={t + "-n"} style={{ padding: "6px 10px", textAlign: "right", color: "#7a9a8a", fontSize: 11 }}>{s ? s.n : "—"}</td>
                            </>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Individual unit records */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#7a9a8a", marginBottom: 10 }}>
            Individual Unit Records
          </div>
          <BuildingTable
            units={building.units.map((u) => ({
              id: u.id,
              unitName: u.unitName,
              unitNumber: u.unitNumber,
              unitType: u.unitType,
              floor: u.floor,
              sf: u.sf,
              bedrooms: u.bedrooms,
              bathrooms: u.bathrooms,
              askingRent: u.askingRent,
              netRent: u.netRent,
              grossRent: u.grossRent,
              psf: u.psf,
              concessions: u.concessions,
              leaseDate: u.leaseDate,
              leaseStartDate: u.leaseStartDate,
              leaseEndDate: u.leaseEndDate,
              leaseTerm: u.leaseTerm,
              status: u.status,
              notes: u.notes,
            }))}
            buildingName={building.name}
          />
        </div>
      </div>
    </div>
  );
}
