import { NextResponse } from "next/server";
import { getEnvInt } from "@/lib/env";
import { createBatch, finalizeBatch, processOneRun } from "@/lib/pipeline";

export const runtime = "nodejs";
// 300 is the max allowed on Vercel's Hobby plan (Pro + Fluid Compute allows
// up to 800s). Each design takes a few minutes (image gen + upscale polling +
// Canva/Etsy/Printify calls), so this comfortably fits one design a day.
// If you raise LISTINGS_PER_DAY enough that a run risks exceeding 300s,
// either upgrade to Pro (and raise this back up) or split this into a
// queue-driven design instead.
export const maxDuration = 300;
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

  // Publishing needs Etsy + Printify credentials. Until those are set,
  // PIPELINE_ENABLED stays unset/false so the daily cron doesn't spend
  // Claude/Recraft/Replicate credits generating art with nowhere to publish.
  // Flip PIPELINE_ENABLED=true once ETSY_* and PRINTIFY_* are configured.
  if (process.env.PIPELINE_ENABLED !== "true") {
    return NextResponse.json({
      skipped: true,
      reason: "PIPELINE_ENABLED is not set to 'true'. Set it in Vercel env vars once Etsy/Printify credentials are configured.",
    });
  }

  const listingsPerDay = getEnvInt("LISTINGS_PER_DAY", 1);
  const batchId = await createBatch(listingsPerDay);

  let succeeded = 0;
  let rejected = 0;
  let failed = 0;

  try {
    for (let i = 0; i < listingsPerDay; i++) {
      // Each design is fully isolated: one failing does not stop the others.
      // The inner try/catch also guards against a design throwing an
      // unhandled error (e.g. a DB schema mismatch) — without it, the whole
      // batch would get stuck at status='running' forever with no record of
      // what happened, since finalizeBatch below would never run.
      try {
        const outcome = await processOneRun(batchId);
        if (outcome === "completed") succeeded++;
        else if (outcome === "rejected") rejected++;
        else failed++;
      } catch (err) {
        console.error("[pipeline:run] Unexpected error processing a design:", err);
        failed++;
      }
    }
  } finally {
    await finalizeBatch(batchId, { succeeded, rejected, failed });
  }

  // See app/api/pipeline/status/route.ts for why this is set explicitly:
  // force-dynamic alone doesn't stop a CDN/browser from caching this GET
  // response, which previously showed the exact same stale batchId/counts
  // on a second manual trigger instead of actually running again.
  return NextResponse.json(
    { batchId, requested: listingsPerDay, succeeded, rejected, failed },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
