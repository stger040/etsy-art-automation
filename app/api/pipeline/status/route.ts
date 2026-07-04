import { NextResponse } from "next/server";
import { getRecentRunHistory } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 50;
  const history = await getRecentRunHistory(limit);
  return NextResponse.json(history);
}
