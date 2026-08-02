import { getEnv, requireEnv } from "./env";
import type { Orientation } from "./orientation";

/**
 * NOTE ON "MAX RESOLUTION": Recraft's public API accepts a "WxH" size string
 * from a fixed set of supported dimensions (their largest long edge is
 * currently 2048px). "1024x1365"/"1365x1024" are the largest options that
 * match a 3:4 / 4:3 ratio (the same ratio as the 4500x6000 / 6000x4500
 * upscale targets). Verify this against the current Recraft API reference
 * (recraft.ai/docs) with `npm run test:recraft` before relying on it —
 * third-party mirrors of this API disagree on the exact enum, so this is the
 * one integration in this project most worth confirming live.
 */
const DEFAULT_SIZE_BY_ORIENTATION: Record<Orientation, string> = {
  vertical: "1024x1365",
  horizontal: "1365x1024",
};

export type RecraftImage = {
  url: string;
};

export async function generateImage(prompt: string, orientation: Orientation = "vertical"): Promise<RecraftImage> {
  const sizeEnvVar = orientation === "horizontal" ? "RECRAFT_SIZE_HORIZONTAL" : "RECRAFT_SIZE";
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requireEnv("RECRAFT_API_KEY")}`,
    },
    body: JSON.stringify({
      prompt,
      model: "recraftv3",
      style: getEnv("RECRAFT_STYLE", "digital_illustration"),
      size: getEnv(sizeEnvVar, DEFAULT_SIZE_BY_ORIENTATION[orientation]),
      n: 1,
      response_format: "url",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recraft API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { data: Array<{ url: string }> };
  const image = json.data?.[0];
  if (!image?.url) {
    throw new Error("Recraft API returned no image URL");
  }
  return { url: image.url };
}
