/**
 * Central env var access. Each external API module calls `requireEnv` for the
 * keys it needs right before making a call, so a missing key only fails that
 * one step (and gets logged to pipeline_step_errors) instead of crashing the
 * whole cron run at import time.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
