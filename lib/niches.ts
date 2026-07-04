import { query } from "./db";
import type { Niche } from "./types";

/**
 * Picks the least-recently-used active niche and stamps last_used_at so the
 * next call rotates to a different one. Falls back to a generic niche if the
 * table is empty (e.g. schema just applied, seed rows were deleted).
 */
export async function pickNextNiche(): Promise<Niche> {
  const rows = await query<Niche>(
    `select * from niches where active = true
     order by last_used_at asc nulls first, id asc
     limit 1`
  );

  if (rows.length === 0) {
    return {
      id: 0,
      name: "General art",
      description: "General decorative wall art",
      prompt_style: "clean modern wall art, versatile decor style",
      active: true,
      last_used_at: null,
      created_at: new Date().toISOString(),
    };
  }

  const niche = rows[0];
  if (niche.id !== 0) {
    await query(`update niches set last_used_at = now() where id = $1`, [niche.id]);
  }
  return niche;
}
