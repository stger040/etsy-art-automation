import { getEnv, requireEnv } from "./env";
import { getValidAccessToken } from "./oauth-store";
import { fetchImageBuffer } from "./image";
import type { Orientation } from "./orientation";

const API_BASE = "https://api.canva.com/rest/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

async function getAccessToken(): Promise<string> {
  return getValidAccessToken({
    provider: "canva",
    seedAccessToken: "", // Canva access tokens are short-lived (~4h); always refresh on first use.
    seedRefreshToken: requireEnv("CANVA_REFRESH_TOKEN"),
    refresh: async (refreshToken) => {
      const clientId = requireEnv("CANVA_CLIENT_ID");
      const clientSecret = requireEnv("CANVA_CLIENT_SECRET");
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const res = await fetch(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${basicAuth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Canva token refresh error ${res.status}: ${text.slice(0, 500)}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in };
    },
  });
}

async function canvaFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Canva API error ${res.status} on ${path}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

/** Uploads the art image into the connected Canva account as a reusable asset. */
async function uploadAsset(imageUrl: string, name: string): Promise<string> {
  const buffer = await fetchImageBuffer(imageUrl);
  const token = await getAccessToken();

  const createRes = await fetch(`${API_BASE}/asset-uploads`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(name).toString("base64") }),
    },
    body: new Uint8Array(buffer),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Canva asset upload error ${createRes.status}: ${text.slice(0, 500)}`);
  }
  const created = (await createRes.json()) as { job: { id: string; status: string } };

  const job = await pollJob<{ asset: { id: string } }>(`/asset-uploads/${created.job.id}`);
  return job.asset.id;
}

async function pollJob<TResult>(path: string): Promise<TResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const json = (await canvaFetch(path)) as {
      job: { status: "in_progress" | "success" | "failed"; result?: TResult; error?: { message: string } };
    };
    if (json.job.status === "success" && json.job.result) return json.job.result;
    if (json.job.status === "failed") {
      throw new Error(`Canva job failed: ${json.job.error?.message ?? "unknown error"}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Canva job at ${path} timed out`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Autofills the configured mockup brand template with the art image, then
 * exports the result as a flat PNG mockup. Returns the design id (for
 * reference) and the exported mockup image URL. Uses CANVA_MOCKUP_TEMPLATE_ID
 * for a portrait design, CANVA_MOCKUP_TEMPLATE_ID_HORIZONTAL for a landscape
 * one — a portrait-framed template would badly crop/stretch a landscape image.
 *
 * Assumes the brand template has an image field named per CANVA_IMAGE_FIELD
 * (default "image") — check this with `get-brand-template-dataset` /
 * `npm run test:canva` against your actual template.
 */
export async function createMockup(
  imageUrl: string,
  runId: string,
  orientation: Orientation = "vertical"
): Promise<{ designId: string; mockupUrl: string }> {
  const templateId =
    orientation === "horizontal"
      ? requireEnv("CANVA_MOCKUP_TEMPLATE_ID_HORIZONTAL")
      : requireEnv("CANVA_MOCKUP_TEMPLATE_ID");
  const imageFieldName = getEnv("CANVA_IMAGE_FIELD_NAME", "image");

  const assetId = await uploadAsset(imageUrl, `pipeline-run-${runId}`);

  const autofillCreate = (await canvaFetch("/autofills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      brand_template_id: templateId,
      title: `Pipeline run ${runId}`,
      data: {
        [imageFieldName]: { type: "image", asset_id: assetId },
      },
    }),
  })) as { job: { id: string } };

  const autofillResult = await pollJob<{ design: { id: string } }>(`/autofills/${autofillCreate.job.id}`);
  const designId = autofillResult.design.id;

  const exportCreate = (await canvaFetch("/exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ design_id: designId, format: { type: "png" } }),
  })) as { job: { id: string } };

  const exportResult = await pollJob<{ urls: string[] }>(`/exports/${exportCreate.job.id}`);
  const mockupUrl = exportResult.urls[0];
  if (!mockupUrl) {
    throw new Error("Canva export job succeeded but returned no URL");
  }

  return { designId, mockupUrl };
}
