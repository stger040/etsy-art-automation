import { query } from "./db";
import type { PipelineBatch, PipelineRun } from "./types";

export type RunHistory = {
  batches: PipelineBatch[];
  runs: (PipelineRun & { niche_name: string | null })[];
};

export async function getRecentRunHistory(limit = 50): Promise<RunHistory> {
  const batches = await query<PipelineBatch>(
    `select * from pipeline_batches order by started_at desc limit 20`
  );

  const runs = await query<PipelineRun & { niche_name: string | null }>(
    `select pipeline_runs.*, niches.name as niche_name
     from pipeline_runs
     left join niches on niches.id = pipeline_runs.niche_id
     order by pipeline_runs.created_at desc
     limit $1`,
    [limit]
  );

  return { batches, runs };
}
