import "./admin.css";
import AdminNav from "./components/AdminNav";
import DraftBar from "./components/DraftBar";
import { prisma } from "@/app/lib/prisma";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const draftCount = await prisma.adminDraft.count().catch(() => 0);
  return (
    <div className="admin-shell">
      <AdminNav />
      <main className="admin-main" style={{ paddingBottom: draftCount > 0 ? "52px" : undefined }}>
        {children}
      </main>
      <DraftBar initialCount={draftCount} />
    </div>
  );
}
