export type Orientation = "vertical" | "horizontal";

/**
 * Randomly picks an orientation per design so the shop ends up with a mix of
 * portrait and landscape canvas/poster listings instead of only ever
 * portrait. PIPELINE_LANDSCAPE_PROBABILITY (0-1) controls the split; defaults
 * to an even 50/50 mix.
 */
export function pickOrientation(): Orientation {
  const raw = Number(process.env.PIPELINE_LANDSCAPE_PROBABILITY);
  const landscapeProbability = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.5;
  return Math.random() < landscapeProbability ? "horizontal" : "vertical";
}
