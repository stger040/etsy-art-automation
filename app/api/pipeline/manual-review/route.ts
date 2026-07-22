import { NextResponse } from "next/server";
import { setManualReviewStatus } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { runId?: string; status?: string } | null;

  if (!body?.runId || (body.status !== "published" && body.status !== "skipped")) {
    return NextResponse.json({ error: "Expects { runId: string, status: 'published' | 'skipped' }" }, { status: 400 });
  }

  await setManualReviewStatus(body.runId, body.status);
  return NextResponse.json({ ok: true });
}
