import { getEnvBool, getEnvInt, requireEnv } from "./env";
import type { GeneratedListing } from "./types";

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
    throw new Error(`Printify API error ${res.status} on ${path}: ${text.slice(0, 500)}`);
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

async function getAllVariantIds(blueprintId: number, printProviderId: number): Promise<number[]> {
  const data = (await printifyFetch(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`
  )) as { variants: Array<{ id: number }> };
  return data.variants.map((v) => v.id);
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
}): Promise<string> {
  const shopId = requireEnv("PRINTIFY_SHOP_ID");
  const variantIds = await getAllVariantIds(params.blueprintId, params.printProviderId);

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
 * PRINTIFY_ENABLE_CANVAS, both default true), with every catalog size
 * variant enabled. All publish through Printify's native Etsy sales channel
 * integration.
 *
 * A t-shirt product is included too if PRINTIFY_SHIRT_BLUEPRINT_ID is set —
 * left opt-in because apparel print areas are proportioned very differently
 * from a 4500x6000 poster image (a full-bleed scale=1 placement that looks
 * right on a poster will usually overflow a shirt's print area). Check the
 * first shirt product's preview in the Printify dashboard and tune
 * PRINTIFY_SHIRT_IMAGE_SCALE if the art is cropped too tight or too small.
 */
export async function createAndPublishPodProducts(
  listing: GeneratedListing,
  imageUrl: string,
  runId: string
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
    });
    await publishProduct(productId);
    productIds.push(productId);
  }

  return { productIds };
}
