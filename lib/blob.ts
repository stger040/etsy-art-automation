import { put } from "@vercel/blob";
import { requireEnv } from "./env";
import { fetchImageBuffer } from "./image";

/** Downloads the upscaled image and re-hosts it on Vercel Blob as the durable, canonical asset URL. */
export async function uploadToBlob(sourceUrl: string, runId: string): Promise<string> {
  const buffer = await fetchImageBuffer(sourceUrl);
  const blob = await put(`pipeline-runs/${runId}.png`, buffer, {
    access: "public",
    contentType: "image/png",
    token: requireEnv("BLOB_READ_WRITE_TOKEN"),
    addRandomSuffix: false,
  });
  return blob.url;
}
