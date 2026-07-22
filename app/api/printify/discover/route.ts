import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time setup utility: looks up your Printify shop ID and canvas
 * blueprint/print-provider IDs using the PRINTIFY_API_TOKEN already set in
 * Vercel, so you don't have to hunt for them in Printify's UI (blueprint IDs
 * in particular aren't shown anywhere in the dashboard).
 *
 * Visit /api/printify/discover?secret=YOUR_CRON_SECRET&search=canvas
 * (search defaults to "canvas"; pass a different term to look up other
 * product types, e.g. search=poster or search=t-shirt).
 *
 * Add &blueprint=<id> to instead list every print provider's size variants
 * for that one blueprint, so you can compare size coverage before picking a
 * print_provider_id, e.g. /api/printify/discover?secret=...&blueprint=937
 *
 * Add &testwrite=1 to diagnose a write-specific auth problem: POSTs a
 * deliberately incomplete product body (missing required fields) to
 * /shops/{PRINTIFY_SHOP_ID}/products.json and shows the raw response. A 400
 * validation error back means the token/shop auth is fine for writes and
 * only the real request body was the issue; a 401 here confirms it's a
 * genuine write-permission problem unrelated to payload content.
 */
async function printifyFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.printify.com/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${requireEnv("PRINTIFY_API_TOKEN")}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Printify API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== requireEnv("CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const search = (url.searchParams.get("search") || "canvas").toLowerCase();
  const blueprintParam = url.searchParams.get("blueprint");
  const testWrite = url.searchParams.get("testwrite");

  const lines: string[] = [];

  if (testWrite) {
    const shopId = requireEnv("PRINTIFY_SHOP_ID");
    const body =
      testWrite === "full"
        ? {
            title: "Diagnostic test product (safe to ignore/delete)",
            description: "Diagnostic test product",
            blueprint_id: Number(process.env.PRINTIFY_CANVAS_BLUEPRINT_ID) || 937,
            print_provider_id: Number(process.env.PRINTIFY_CANVAS_PRINT_PROVIDER_ID) || 99,
            // Deliberately still missing variants/print_areas (both required)
            // so this can't accidentally succeed and create a real product —
            // it should 400 on validation if write auth is actually fine.
          }
        : {};
    lines.push(
      `=== Write-auth test: POST /shops/${shopId}/products.json (${
        testWrite === "full" ? "fuller but still incomplete" : "empty"
      } body) ===`
    );
    const res = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requireEnv("PRINTIFY_API_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    lines.push(`status: ${res.status}`);
    lines.push(`body: ${text.slice(0, 1000)}`);
    lines.push("headers:");
    for (const [key, value] of res.headers.entries()) {
      if (!["date", "content-length"].includes(key)) lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
    lines.push(
      res.status === 401
        ? "-> 401 means this is a genuine write-permission problem, not the request body."
        : "-> Not a 401, so auth for writes is working; the real pipeline failure has a different cause."
    );
    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
  }

  if (blueprintParam) {
    const blueprintId = Number(blueprintParam);
    lines.push(`=== Size variants per print provider for blueprint_id=${blueprintId} ===`);
    try {
      const providers = (await printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers.json`)) as Array<{
        id: number;
        title: string;
      }>;
      for (const p of providers) {
        lines.push(`\nprint_provider_id=${p.id}  "${p.title}"`);
        try {
          const data = (await printifyFetch(
            `/catalog/blueprints/${blueprintId}/print_providers/${p.id}/variants.json`
          )) as { variants: Array<{ id: number; title: string }> };
          for (const v of data.variants) {
            lines.push(`    variant_id=${v.id}  "${v.title}"`);
          }
        } catch (err) {
          lines.push(`    (failed to fetch variants: ${err instanceof Error ? err.message : String(err)})`);
        }
      }
    } catch (err) {
      lines.push(`Failed to fetch print providers: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
  }

  try {
    const shops = (await printifyFetch("/shops.json")) as Array<{
      id: number;
      title: string;
      sales_channel: string;
    }>;
    lines.push("=== Your Printify shops (PRINTIFY_SHOP_ID) ===");
    if (shops.length === 0) {
      lines.push("No shops found on this Printify account/token.");
    }
    for (const shop of shops) {
      lines.push(`id=${shop.id}  title="${shop.title}"  sales_channel=${shop.sales_channel}`);
    }
  } catch (err) {
    lines.push(`Failed to fetch shops: ${err instanceof Error ? err.message : String(err)}`);
  }

  lines.push("");
  lines.push(`=== Blueprints matching "${search}" (PRINTIFY_*_BLUEPRINT_ID) ===`);

  try {
    const blueprints = (await printifyFetch("/catalog/blueprints.json")) as Array<{
      id: number;
      title: string;
      brand: string;
      model: string;
    }>;
    const matches = blueprints.filter((b) => b.title.toLowerCase().includes(search));

    if (matches.length === 0) {
      lines.push(`No blueprints matched "${search}". Try a different ?search= term.`);
    }

    for (const bp of matches.slice(0, 25)) {
      lines.push(`\nblueprint_id=${bp.id}  "${bp.title}"  (${bp.brand} / ${bp.model})`);
      try {
        const providers = (await printifyFetch(`/catalog/blueprints/${bp.id}/print_providers.json`)) as Array<{
          id: number;
          title: string;
        }>;
        for (const p of providers) {
          lines.push(`    print_provider_id=${p.id}  "${p.title}"`);
        }
      } catch (err) {
        lines.push(`    (failed to fetch print providers: ${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (matches.length > 25) {
      lines.push(`\n...and ${matches.length - 25} more matches not shown.`);
    }
  } catch (err) {
    lines.push(`Failed to fetch blueprints: ${err instanceof Error ? err.message : String(err)}`);
  }

  lines.push("");
  lines.push("Pick a print_provider_id you actually want to fulfill through (check pricing/shipping in Printify's UI for that provider), then set e.g.:");
  lines.push("  PRINTIFY_CANVAS_BLUEPRINT_ID=<blueprint_id>");
  lines.push("  PRINTIFY_CANVAS_PRINT_PROVIDER_ID=<print_provider_id>");

  return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
}
