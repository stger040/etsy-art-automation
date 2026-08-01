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
 *
 * Add &testwrite=real for a fully valid, production-shaped payload instead
 * (real uploaded image, real variant IDs) — the exact request the pipeline
 * itself would send, for handing to Printify support when they need "a
 * properly formatted payload that still fails". NOTE: if auth happens to
 * succeed this really does create a product (unpublished, not pushed to
 * Etsy) — safe to delete from Printify afterwards either way.
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
  const raw = url.searchParams.get("raw");

  const lines: string[] = [];

  if (testWrite === "real") {
    const shopId = requireEnv("PRINTIFY_SHOP_ID");
    const token = requireEnv("PRINTIFY_API_TOKEN");
    const blueprintId = Number(process.env.PRINTIFY_CANVAS_BLUEPRINT_ID) || 937;
    const printProviderId = Number(process.env.PRINTIFY_CANVAS_PRINT_PROVIDER_ID) || 99;

    lines.push(`=== Full production-shaped write test (blueprint ${blueprintId}, provider ${printProviderId}) ===`);

    // 1. Upload a real test image, exactly like the pipeline does.
    let imageId: string;
    try {
      const uploadRes = await fetch("https://api.printify.com/v1/uploads/images.json", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          file_name: "diagnostic-test.png",
          url: "https://placehold.co/4500x6000.png?text=test",
        }),
      });
      const uploadText = await uploadRes.text();
      lines.push(`Image upload: status ${uploadRes.status}`);
      if (!uploadRes.ok) {
        lines.push(`Image upload body: ${uploadText.slice(0, 500)}`);
        return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
      }
      imageId = (JSON.parse(uploadText) as { id: string }).id;
      lines.push(`Uploaded image id: ${imageId}`);
    } catch (err) {
      lines.push(`Image upload failed: ${err instanceof Error ? err.message : String(err)}`);
      return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
    }

    // 2. Fetch real variant IDs for the configured blueprint/provider.
    let variantIds: number[];
    try {
      const variantsRes = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const data = (await variantsRes.json()) as { variants: Array<{ id: number }> };
      variantIds = data.variants.map((v) => v.id);
      lines.push(`Fetched ${variantIds.length} real variant ids.`);
    } catch (err) {
      lines.push(`Variant fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
    }

    // 3. The exact payload shape lib/printify.ts's createProduct sends.
    const payload = {
      title: "Diagnostic test product (safe to delete)",
      description: "Diagnostic test product for Printify support",
      tags: ["diagnostic", "test"],
      blueprint_id: blueprintId,
      print_provider_id: printProviderId,
      variants: variantIds.map((id) => ({ id, price: 4500, is_enabled: true })),
      print_areas: [
        {
          variant_ids: variantIds,
          placeholders: [{ position: "front", images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
        },
      ],
    };

    lines.push("");
    lines.push("Full request body:");
    lines.push(JSON.stringify(payload, null, 2));

    // 4. POST it.
    const res = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    lines.push("");
    lines.push(`Response status: ${res.status}`);
    lines.push(`Response body: ${text}`);
    lines.push("Response headers:");
    for (const [key, value] of res.headers.entries()) {
      if (!["date", "content-length"].includes(key)) lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
    lines.push(
      res.ok
        ? "-> This succeeded! A real (unpublished) product was created — delete it from Printify if unwanted."
        : "-> Failed — this is the exact repro to send Printify support: real endpoint, fully valid payload, full response above."
    );

    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/plain" } });
  }

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

  if (blueprintParam && raw) {
    // Dumps the completely unfiltered variants.json response for one
    // provider, to see every field Printify actually returns (e.g. whether
    // a per-variant `cost` field is present) rather than guessing from docs.
    const blueprintId = Number(blueprintParam);
    const printProviderId = Number(raw) || Number(process.env.PRINTIFY_CANVAS_PRINT_PROVIDER_ID) || 99;
    lines.push(`=== Raw variants.json for blueprint ${blueprintId}, print_provider ${printProviderId} ===`);
    try {
      const data = await printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`);
      lines.push(JSON.stringify(data, null, 2));
    } catch (err) {
      lines.push(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
