import { getEnv, requireEnv } from "./env";
import { computeUpscaleFactor, getImageDimensions } from "./image";

const TARGET_WIDTH = 4500;
const TARGET_HEIGHT = 6000;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
  urls: { get: string };
};

function authHeaders() {
  return {
    authorization: `Token ${requireEnv("REPLICATE_API_TOKEN")}`,
    "content-type": "application/json",
  };
}

async function createPrediction(imageUrl: string, scale: number): Promise<Prediction> {
  // Pinning a version hash avoids surprise behavior changes; set
  // REPLICATE_MODEL_VERSION to pin one (get it from the model's API tab).
  // Falls back to running the model's latest version via the /models/{owner}/{name}/predictions
  // endpoint, which doesn't require a version hash.
  const pinnedVersion = process.env.REPLICATE_MODEL_VERSION;
  const model = getEnv("REPLICATE_MODEL", "nightmareai/real-esrgan");

  const url = pinnedVersion
    ? "https://api.replicate.com/v1/predictions"
    : `https://api.replicate.com/v1/models/${model}/predictions`;

  const body = pinnedVersion
    ? { version: pinnedVersion, input: { image: imageUrl, scale, face_enhance: false } }
    : { input: { image: imageUrl, scale, face_enhance: false } };

  const res = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate API error ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<Prediction>;
}

async function pollPrediction(prediction: Prediction): Promise<Prediction> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = prediction;

  while (current.status !== "succeeded" && current.status !== "failed" && current.status !== "canceled") {
    if (Date.now() > deadline) {
      throw new Error(`Replicate prediction ${current.id} timed out after ${POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const res = await fetch(current.urls.get, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`Replicate poll error ${res.status}`);
    }
    current = (await res.json()) as Prediction;
  }

  if (current.status !== "succeeded") {
    throw new Error(`Replicate prediction ${current.id} ${current.status}: ${current.error ?? "unknown error"}`);
  }

  return current;
}

/**
 * Upscales imageUrl via Real-ESRGAN to at least 4500x6000px. Computes the
 * scale factor from the source image's actual dimensions rather than
 * assuming Recraft's output size, so it stays correct if RECRAFT_SIZE changes.
 */
export async function upscaleImage(imageUrl: string): Promise<{ url: string; width: number; height: number }> {
  const sourceDims = await getImageDimensions(imageUrl);
  const scale = computeUpscaleFactor(sourceDims, { width: TARGET_WIDTH, height: TARGET_HEIGHT });

  const started = await createPrediction(imageUrl, scale);
  const finished = await pollPrediction(started);

  const output = Array.isArray(finished.output) ? finished.output[finished.output.length - 1] : finished.output;
  if (!output) {
    throw new Error("Replicate prediction succeeded but returned no output image");
  }

  const finalDims = await getImageDimensions(output);
  if (finalDims.width < TARGET_WIDTH || finalDims.height < TARGET_HEIGHT) {
    throw new Error(
      `Upscaled image (${finalDims.width}x${finalDims.height}) is smaller than the required ${TARGET_WIDTH}x${TARGET_HEIGHT}`
    );
  }

  return { url: output, width: finalDims.width, height: finalDims.height };
}
