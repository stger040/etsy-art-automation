import { neon } from "@neondatabase/serverless";
import { requireEnv } from "./env";

let cached: ReturnType<typeof neon> | null = null;

/** Lazily-created Neon HTTP query function, shared across a single invocation. */
export function db() {
  if (!cached) {
    cached = neon(requireEnv("DATABASE_URL"));
  }
  return cached;
}

/** Convenience helper for parameterized queries: query<Row>('select ... where id = $1', [id]) */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = db();
  const rows = await sql(text, params);
  return rows as T[];
}
