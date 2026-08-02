import { NextResponse } from "next/server";
import { getRecentRunHistory } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 50;
  const history = await getRecentRunHistory(limit);
  // `dynamic = "force-dynamic"` only controls Next's own rendering/data-cache
  // behavior; a Route Handler's actual HTTP response has no Cache-Control
  // header unless set explicitly, so a CDN or browser downstream can still
  // cache this JSON and serve a stale run history after a new pipeline run.
  return NextResponse.json(history, { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
}
