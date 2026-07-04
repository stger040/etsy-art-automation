import { imageSize } from "image-size";

export type Dimensions = { width: number; height: number };

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image at ${url}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function getImageDimensions(url: string): Promise<Dimensions> {
  const buffer = await fetchImageBuffer(url);
  const { width, height } = imageSize(buffer);
  if (!width || !height) {
    throw new Error(`Could not determine dimensions for image at ${url}`);
  }
  return { width, height };
}

/** Scale factor needed to reach at least targetWidth x targetHeight, with a small safety margin. */
export function computeUpscaleFactor(current: Dimensions, target: Dimensions): number {
  const raw = Math.max(target.width / current.width, target.height / current.height);
  return Math.ceil(raw * 100 * 1.05) / 100; // +5% margin, rounded to 2 decimals
}
