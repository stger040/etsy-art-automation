export type MockupStyle = "light" | "dark";

/**
 * Randomly picks a mockup room style per design (light neutral room vs. dark
 * "man cave" room) so the Etsy shop's listing photos aren't all the same
 * look. This only affects which Canva mockup template gets autofilled — the
 * art itself, pricing, and listing copy are unaffected.
 * PIPELINE_DARK_MOCKUP_PROBABILITY (0-1) controls the split; defaults to 0.3
 * (dark stays a minority style, not the default look).
 */
export function pickMockupStyle(): MockupStyle {
  const raw = Number(process.env.PIPELINE_DARK_MOCKUP_PROBABILITY);
  const darkProbability = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.3;
  return Math.random() < darkProbability ? "dark" : "light";
}
