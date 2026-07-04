import { NextResponse } from "next/server";
import { getEnvInt } from "@/lib/env";
import { createBatch, finalizeBatch, processOneRun } from "@/lib/pipeline";

export const runtime = "nodejs";
// Each design can take a few minutes (image gen + upscale polling + Canva/Etsy/
// Printify calls). 800s requires Fluid Compute (on by default for new Vercel
// Pro projects) — if your project predates that, lower this to <=300 and keep
// LISTINGS_PER_DAY small, or split this into a queue-driven design instead.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set it in your Vercel project env vars." },
      { status: 500 }
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listingsPerDay = getEnvInt("LISTINGS_PER_DAY", 1);
  const batchId = await createBatch(listingsPerDay);

  let succeeded = 0;
  let rejected = 0;
  let failed = 0;

  for (let i = 0; i < listingsPerDay; i++) {
    // Each design is fully isolated: one failing does not stop the others.
    const outcome = await processOneRun(batchId);
    if (outcome === "completed") succeeded++;
    else if (outcome === "rejected") rejected++;
    else failed++;
  }

  await finalizeBatch(batchId, { succeeded, rejected, failed });

  return NextResponse.json({ batchId, requested: listingsPerDay, succeeded, rejected, failed });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
