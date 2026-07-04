import { getEnvInt, requireEnv } from "./env";
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
              images: [{ id: params.imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
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

/**
 * Creates and publishes a poster product and a canvas product from the same
 * upscaled image, each with every catalog size variant enabled. Both publish
 * through Printify's native Etsy sales channel integration.
 */
export async function createAndPublishPodProducts(
  listing: GeneratedListing,
  imageUrl: string,
  runId: string
): Promise<{ productIds: string[] }> {
  const priceCents = getEnvInt("PRINTIFY_DEFAULT_PRICE_CENTS", 4500);
  const imageId = await uploadImage(imageUrl, `pipeline-run-${runId}.png`);

  const blueprints = [
    {
      label: "poster",
      blueprintId: getEnvInt("PRINTIFY_POSTER_BLUEPRINT_ID", 97),
      printProviderId: getEnvInt("PRINTIFY_POSTER_PRINT_PROVIDER_ID", 1),
    },
    {
      label: "canvas",
      blueprintId: getEnvInt("PRINTIFY_CANVAS_BLUEPRINT_ID", 196),
      printProviderId: getEnvInt("PRINTIFY_CANVAS_PRINT_PROVIDER_ID", 1),
    },
  ];

  const productIds: string[] = [];
  for (const bp of blueprints) {
    const productId = await createProduct({
      title: listing.etsy_title,
      description: listing.etsy_description,
      tags: listing.etsy_tags,
      blueprintId: bp.blueprintId,
      printProviderId: bp.printProviderId,
      imageId,
      priceCents,
    });
    await publishProduct(productId);
    productIds.push(productId);
  }

  return { productIds };
}
