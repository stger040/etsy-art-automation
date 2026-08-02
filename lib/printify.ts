import { getEnvBool, getEnvInt, requireEnv } from "./env";
import type { ListingCopy } from "./types";

const API_BASE = "https://api.printify.com/v1";

async function printifyFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${requireEnv("PRINTIFY_API_TOKEN")}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const headerDump = Array.from(res.headers.entries())
      .filter(([key]) => !["date", "content-length"].includes(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join(" | ");
    throw new Error(`Printify API error ${res.status} on ${path}: ${text.slice(0, 500)} [headers: ${headerDump}]`);
  }
  return res.json();
}

async function uploadImage(imageUrl: string, fileName: string): Promise<string> {
  const uploaded = (await printifyFetch("/uploads/images.json", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, url: imageUrl }),
  })) as { id: string };
  return uploaded.id;
}

type Orientation = "vertical" | "horizontal" | "square";

function imageOrientation(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.05) return "horizontal";
  if (ratio < 0.95) return "vertical";
  return "square";
}

// Printify variant titles for size-per-orientation blueprints (posters,
// canvases) are plain `<width>" x <height>"` strings, e.g. `11" x 14"`
// (portrait) vs. `14" x 11"` (landscape) as two separate variants — there is
// no "(Vertical)"/"(Horizontal)" label at all (confirmed via
// /api/printify/discover against the real catalog: blueprint 97's variants
// are titled like `14" x 11"`, `11" x 14"`, `14" x 14"`, etc). Orientation is
// inferred from which number is larger. Blueprints without any parseable
// "<number> x <number>" titles at all (e.g. apparel sized S/M/L) aren't
// filtered.
function parseVariantSizeInches(title: string): { width: number; height: number } | null {
  const match = title.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

// Widening relative-tolerance tiers for how far a variant's aspect ratio may
// stray from the generated image's before it's excluded. A 4:3 image should
// prefer exact multiples of 4:3 (12x9, 16x12, 24x18, ...) over, say, a 5x4
// size that would visibly crop/pad it — but a shop needs more than one or
// two exact-match sizes to look like a real listing, so the tolerance widens
// step by step until PRINTIFY_MIN_SIZE_OPTIONS is met.
const ASPECT_RATIO_TOLERANCE_TIERS = [0.02, 0.05, 0.08, 0.15, 0.25];

/**
 * Picks the variant IDs matching the generated image's aspect ratio, so a
 * design only enables sizes that are exact (or near-exact) multiples of its
 * own proportions instead of every size sharing its broad orientation —
 * e.g. a 4:3 image gets 12x9/16x12/24x18/32x24 but not a 5x4-ratio size that
 * would crop or pad it. Falls back to every variant if the blueprint has no
 * parseable WxH-sized variants (apparel), and falls back to the full
 * orientation-matched set if ratio filtering can't reach the minimum count.
 */
async function getMatchingVariantIds(
  blueprintId: number,
  printProviderId: number,
  imageWidth: number,
  imageHeight: number
): Promise<number[]> {
  const data = (await printifyFetch(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`
  )) as { variants: Array<{ id: number; title: string }> };

  const sized = data.variants
    .map((v) => ({ id: v.id, size: parseVariantSizeInches(v.title) }))
    .filter((v): v is { id: number; size: { width: number; height: number } } => v.size !== null);

  if (sized.length === 0) {
    return data.variants.map((v) => v.id);
  }

  const targetOrientation = imageOrientation(imageWidth, imageHeight);
  const sameOrientation = sized.filter((v) => imageOrientation(v.size.width, v.size.height) === targetOrientation);

  if (sameOrientation.length === 0) {
    return sized.map((v) => v.id);
  }

  const targetRatio = imageWidth / imageHeight;
  const ratioDiff = (size: { width: number; height: number }) => Math.abs(size.width / size.height - targetRatio) / targetRatio;

  const minOptions = getEnvInt("PRINTIFY_MIN_SIZE_OPTIONS", 4);
  for (const tolerance of ASPECT_RATIO_TOLERANCE_TIERS) {
    const matched = sameOrientation.filter((v) => ratioDiff(v.size) <= tolerance);
    if (matched.length >= minOptions) {
      return matched.map((v) => v.id);
    }
  }

  return sameOrientation.map((v) => v.id);
}

/**
 * Printify's catalog/variants endpoints never expose a variant's base cost
 * (confirmed by inspecting the raw response — just id/title/size/print-area
 * dimensions). The only place cost shows up is in the response of actually
 * creating a product, computed against your account's real provider rates.
 * So price = cost / (1 - margin), targeting a fixed profit margin regardless
 * of size, rather than a flat price that loses money on larger prints.
 */
function priceFromCost(costCents: number | undefined, marginPct: number, fallbackCents: number): number {
  if (!costCents || costCents <= 0) return fallbackCents;
  return Math.round(costCents / (1 - marginPct));
}

async function createProduct(params: {
  title: string;
  description: string;
  tags: string[];
  blueprintId: number;
  printProviderId: number;
  imageId: string;
  fallbackPriceCents: number;
  marginPct: number;
  imageScale?: number;
  imageWidth: number;
  imageHeight: number;
}): Promise<string> {
  const shopId = requireEnv("PRINTIFY_SHOP_ID");
  const variantIds = await getMatchingVariantIds(
    params.blueprintId,
    params.printProviderId,
    params.imageWidth,
    params.imageHeight
  );

  // Placeholder equal pricing on creation — real per-variant cost only comes
  // back in this same response, so accurate margin-based pricing is applied
  // in a follow-up update right after, before anything gets published.
  const created = (await printifyFetch(`/shops/${shopId}/products.json`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      tags: params.tags,
      blueprint_id: params.blueprintId,
      print_provider_id: params.printProviderId,
      variants: variantIds.map((id) => ({ id, price: params.fallbackPriceCents, is_enabled: true })),
      print_areas: [
        {
          variant_ids: variantIds,
          placeholders: [
            {
              position: "front",
              images: [{ id: params.imageId, x: 0.5, y: 0.5, scale: params.imageScale ?? 1, angle: 0 }],
            },
          ],
        },
      ],
    }),
  })) as { id: string; variants: Array<{ id: number; cost?: number }> };

  const pricedVariants = created.variants.map((v) => ({
    id: v.id,
    price: priceFromCost(v.cost, params.marginPct, params.fallbackPriceCents),
    is_enabled: true,
  }));

  await printifyFetch(`/shops/${shopId}/products/${created.id}.json`, {
    method: "PUT",
    body: JSON.stringify({ variants: pricedVariants }),
  });

  return created.id;
}

async function publishProduct(productId: string): Promise<void> {
  const shopId = requireEnv("PRINTIFY_SHOP_ID");
  // Publishing to a natively-connected sales channel (Printify's own Etsy
  // integration) only needs this call — Printify syncs the listing to Etsy
  // itself. The publish_succeeded/publish_failed callback endpoints are only
  // needed for a custom/manual "API" sales channel, which this pipeline does
  // not use.
  await printifyFetch(`/shops/${shopId}/products/${productId}/publish.json`, {
    method: "POST",
    body: JSON.stringify({ title: true, description: true, images: true, variants: true, tags: true }),
  });
}

type BlueprintConfig = {
  label: string;
  blueprintId: number;
  printProviderId: number;
  imageScale?: number;
};

/**
 * Creates and publishes a poster product and/or a canvas product from the
 * same upscaled image (each gated behind PRINTIFY_ENABLE_POSTER /
 * PRINTIFY_ENABLE_CANVAS, both default true). Only size variants matching
 * the generated image's aspect ratio (or close to it — see
 * ASPECT_RATIO_TOLERANCE_TIERS / PRINTIFY_MIN_SIZE_OPTIONS above) are
 * enabled, so a 4:3 image gets sizes like 12x9/16x12/24x18 rather than every
 * size sharing its broad vertical/horizontal orientation. Every variant is priced at
 * PRINTIFY_PROFIT_MARGIN (default 30%) over its actual Printify cost, not a
 * flat price — a flat price loses money on larger sizes, which cost far more
 * to produce than small ones. All publish through Printify's native Etsy
 * sales channel integration.
 *
 * A t-shirt product is included too if PRINTIFY_SHIRT_BLUEPRINT_ID is set —
 * left opt-in because apparel print areas are proportioned very differently
 * from a 4500x6000 poster image (a full-bleed scale=1 placement that looks
 * right on a poster will usually overflow a shirt's print area). Check the
 * first shirt product's preview in the Printify dashboard and tune
 * PRINTIFY_SHIRT_IMAGE_SCALE if the art is cropped too tight or too small.
 */
export async function createAndPublishPodProducts(
  listing: ListingCopy,
  imageUrl: string,
  runId: string,
  imageWidth: number,
  imageHeight: number
): Promise<{ productIds: string[] }> {
  const fallbackPriceCents = getEnvInt("PRINTIFY_DEFAULT_PRICE_CENTS", 4500);
  const marginPct = Number(process.env.PRINTIFY_PROFIT_MARGIN) || 0.3;
  const imageId = await uploadImage(imageUrl, `pipeline-run-${runId}.png`);

  const blueprints: BlueprintConfig[] = [];

  if (getEnvBool("PRINTIFY_ENABLE_POSTER", true)) {
    blueprints.push({
      label: "poster",
      blueprintId: getEnvInt("PRINTIFY_POSTER_BLUEPRINT_ID", 97),
      printProviderId: getEnvInt("PRINTIFY_POSTER_PRINT_PROVIDER_ID", 1),
    });
  }

  if (getEnvBool("PRINTIFY_ENABLE_CANVAS", true)) {
    blueprints.push({
      label: "canvas",
      blueprintId: getEnvInt("PRINTIFY_CANVAS_BLUEPRINT_ID", 196),
      printProviderId: getEnvInt("PRINTIFY_CANVAS_PRINT_PROVIDER_ID", 1),
    });
  }

  if (process.env.PRINTIFY_SHIRT_BLUEPRINT_ID) {
    blueprints.push({
      label: "shirt",
      blueprintId: getEnvInt("PRINTIFY_SHIRT_BLUEPRINT_ID", 0),
      printProviderId: getEnvInt("PRINTIFY_SHIRT_PRINT_PROVIDER_ID", 1),
      imageScale: Number(process.env.PRINTIFY_SHIRT_IMAGE_SCALE) || 0.8,
    });
  }

  const productIds: string[] = [];
  for (const bp of blueprints) {
    const productId = await createProduct({
      title: listing.etsy_title,
      description: listing.etsy_description,
      tags: listing.etsy_tags,
      blueprintId: bp.blueprintId,
      printProviderId: bp.printProviderId,
      imageId,
      fallbackPriceCents,
      marginPct,
      imageScale: bp.imageScale,
      imageWidth,
      imageHeight,
    });
    await publishProduct(productId);
    productIds.push(productId);
  }

  return { productIds };
}
