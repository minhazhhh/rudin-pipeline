import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const drafts = await prisma.adminDraft.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(drafts);
}

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { resource, entityId, method, payload, entityLabel } = (await req.json()) as {
    resource: string;
    entityId?: string | null;
    method: string;
    payload?: unknown;
    entityLabel?: string | null;
  };
  const draft = await prisma.adminDraft.create({
    data: {
      resource,
      entityId: entityId ?? null,
      method,
      payload: payload !== undefined ? (payload as object) : undefined,
      entityLabel: entityLabel ?? null,
    },
  });
  return NextResponse.json(draft);
}

export async function DELETE(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const deleted = await prisma.adminDraft.deleteMany();
  return NextResponse.json({ ok: true, deleted: deleted.count });
}
