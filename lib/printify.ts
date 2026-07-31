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
// canvases) are labeled like `16" x 20" (Vertical) / 0.75''` — no suffix
// means a square size. Blueprints without orientation-labeled variants at
// all (e.g. apparel, sized S/M/L instead) aren't filtered.
function variantOrientation(title: string): Orientation {
  if (/\(vertical\)/i.test(title)) return "vertical";
  if (/\(horizontal\)/i.test(title)) return "horizontal";
  return "square";
}

/**
 * Picks the variant IDs matching the generated image's orientation, so a
 * portrait design only enables portrait canvas/poster sizes instead of
 * every size including ones that would badly crop or stretch it. Falls back
 * to every variant if the blueprint has no orientation-labeled variants
 * (apparel) or if filtering would otherwise leave nothing enabled.
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

  const hasOrientedVariants = data.variants.some((v) => /\((vertical|horizontal)\)/i.test(v.title));
  if (!hasOrientedVariants) {
    return data.variants.map((v) => v.id);
  }

  const targetOrientation = imageOrientation(imageWidth, imageHeight);
  const matched = data.variants.filter((v) => variantOrientation(v.title) === targetOrientation);

  return (matched.length > 0 ? matched : data.variants).map((v) => v.id);
}

async function createProduct(params: {
  title: string;
  description: string;
  tags: string[];
  blueprintId: number;
  printProviderId: number;
  imageId: string;
  priceCents: number;
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

  const product = (await printifyFetch(`/shops/${shopId}/products.json`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      tags: params.tags,
      blueprint_id: params.blueprintId,
      print_provider_id: params.printProviderId,
      variants: variantIds.map((id) => ({ id, price: params.priceCents, is_enabled: true })),
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
  })) as { id: string };

  return product.id;
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
  priceCents: number;
  imageScale?: number;
};

/**
 * Creates and publishes a poster product and/or a canvas product from the
 * same upscaled image (each gated behind PRINTIFY_ENABLE_POSTER /
 * PRINTIFY_ENABLE_CANVAS, both default true). Only the size variants whose
 * orientation (vertical/horizontal/square) matches the generated image are
 * enabled — a portrait design won't get landscape or square sizes enabled,
 * since those would crop or stretch it badly. All publish through Printify's
 * native Etsy sales channel integration.
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
  const defaultPriceCents = getEnvInt("PRINTIFY_DEFAULT_PRICE_CENTS", 4500);
  const imageId = await uploadImage(imageUrl, `pipeline-run-${runId}.png`);

  const blueprints: BlueprintConfig[] = [];

  if (getEnvBool("PRINTIFY_ENABLE_POSTER", true)) {
    blueprints.push({
      label: "poster",
      blueprintId: getEnvInt("PRINTIFY_POSTER_BLUEPRINT_ID", 97),
      printProviderId: getEnvInt("PRINTIFY_POSTER_PRINT_PROVIDER_ID", 1),
      priceCents: defaultPriceCents,
    });
  }

  if (getEnvBool("PRINTIFY_ENABLE_CANVAS", true)) {
    blueprints.push({
      label: "canvas",
      blueprintId: getEnvInt("PRINTIFY_CANVAS_BLUEPRINT_ID", 196),
      printProviderId: getEnvInt("PRINTIFY_CANVAS_PRINT_PROVIDER_ID", 1),
      priceCents: defaultPriceCents,
    });
  }

  if (process.env.PRINTIFY_SHIRT_BLUEPRINT_ID) {
    blueprints.push({
      label: "shirt",
      blueprintId: getEnvInt("PRINTIFY_SHIRT_BLUEPRINT_ID", 0),
      printProviderId: getEnvInt("PRINTIFY_SHIRT_PRINT_PROVIDER_ID", 1),
      priceCents: getEnvInt("PRINTIFY_SHIRT_PRICE_CENTS", defaultPriceCents),
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
      priceCents: bp.priceCents,
      imageScale: bp.imageScale,
      imageWidth,
      imageHeight,
    });
    await publishProduct(productId);
    productIds.push(productId);
  }

  return { productIds };
}
