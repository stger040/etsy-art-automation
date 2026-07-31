import { getEnv, requireEnv } from "./env";
import { getValidAccessToken } from "./oauth-store";
import { fetchImageBuffer } from "./image";
import type { ListingCopy } from "./types";

const API_BASE = "https://api.etsy.com/v3/application";

async function getAccessToken(): Promise<string> {
  return getValidAccessToken({
    provider: "etsy",
    seedAccessToken: requireEnv("ETSY_ACCESS_TOKEN"),
    seedRefreshToken: requireEnv("ETSY_REFRESH_TOKEN"),
    refresh: async (refreshToken) => {
      const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: requireEnv("ETSY_API_KEY"),
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Etsy token refresh error ${res.status}: ${text.slice(0, 500)}`);
      }
      const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in };
    },
  });
}

async function etsyFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${token}`,
      "x-api-key": requireEnv("ETSY_API_KEY"),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy API error ${res.status} on ${path}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * IMPORTANT — Etsy's "made with AI" disclosure toggle is a listing-editor-only
 * UI field with no documented Open API v3 field to set it programmatically
 * (see github.com/etsy/open-api discussions #1269 and #1340 — still
 * unresolved as of this writing). This function cannot flip that checkbox for
 * you. It (a) adds an explicit disclosure sentence to the listing description,
 * which satisfies Etsy's *textual* disclosure requirement, and (b) the caller
 * logs a reminder so every run surfaces the manual step. Listings are created
 * as drafts (never auto-activated) specifically so you have a chance to check
 * that box by hand in the Etsy dashboard before the listing goes live.
 */
function withAiDisclosure(description: string): string {
  const disclosure =
    "Disclosure: this design was created with the assistance of AI image-generation tools.";
  return `${description}\n\n${disclosure}`;
}

export async function createDraftDigitalListing(
  listing: ListingCopy
): Promise<{ listingId: string }> {
  const shopId = requireEnv("ETSY_SHOP_ID");

  const body = {
    quantity: 999,
    title: listing.etsy_title,
    description: withAiDisclosure(listing.etsy_description),
    price: Number(getEnv("ETSY_DIGITAL_PRICE", "8.00")),
    who_made: "i_did",
    when_made: "made_to_order",
    is_supply: false,
    type: "download",
    taxonomy_id: Number(requireEnv("ETSY_TAXONOMY_ID")),
    tags: listing.etsy_tags,
  };

  const created = (await etsyFetch(`/shops/${shopId}/listings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })) as { listing_id: number };

  return { listingId: String(created.listing_id) };
}

export async function uploadDigitalFile(listingId: string, fileUrl: string, fileName: string): Promise<void> {
  const shopId = requireEnv("ETSY_SHOP_ID");
  const buffer = await fetchImageBuffer(fileUrl);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), fileName);

  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/shops/${shopId}/listings/${listingId}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-api-key": requireEnv("ETSY_API_KEY") },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy file upload error ${res.status}: ${text.slice(0, 500)}`);
  }
}

export async function uploadListingImage(listingId: string, imageUrl: string): Promise<void> {
  const shopId = requireEnv("ETSY_SHOP_ID");
  const buffer = await fetchImageBuffer(imageUrl);

  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), "listing-image.png");

  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/shops/${shopId}/listings/${listingId}/images`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-api-key": requireEnv("ETSY_API_KEY") },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy image upload error ${res.status}: ${text.slice(0, 500)}`);
  }
}
