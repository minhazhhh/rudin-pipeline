"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/admin/projects", label: "Pipeline Projects" },
  { href: "/admin/comp-buildings", label: "Comp Buildings" },
  { href: "/admin/comp-building-stats", label: "Comp Building Stats" },
  { href: "/admin/comp-stats-range", label: "Stats by Date Range" },
  { href: "/admin/overall-stats", label: "Overall Unit Stats" },
  { href: "/admin/type-stats", label: "Type × Unit Stats" },
  { href: "/admin/trend", label: "Rent Trend" },
  { href: "/admin/sync", label: "Import & Sync" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="admin-topbar">
        <div className="admin-topbar-logo">RUDIN</div>
        <div className="admin-topbar-sub">Pipeline Admin</div>
      </div>
      <nav className="admin-navbar">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={pathname?.startsWith(l.href) ? "active" : ""}>
            {l.label}
          </Link>
        ))}
        <div className="admin-navbar-spacer" />
        <div className="admin-navbar-actions">
          <Link href="/" target="_blank">View live site ↗</Link>
          <button onClick={logout}>Log out</button>
        </div>
      </nav>
    </>
  );
}
