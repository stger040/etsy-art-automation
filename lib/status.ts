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

export type ManualQueueItem = PipelineRun & { niche_name: string | null };

/**
 * Designs that finished generation + compliance approval but failed to
 * auto-publish anywhere (e.g. Printify write access being down), and haven't
 * been handled through the manual fallback flow yet. The image and listing
 * copy already exist — nothing about the design itself needs redoing.
 */
export async function getManualQueue(): Promise<ManualQueueItem[]> {
  return query<ManualQueueItem>(
    `select pipeline_runs.*, niches.name as niche_name
     from pipeline_runs
     left join niches on niches.id = pipeline_runs.niche_id
     where pipeline_runs.status = 'failed'
       and pipeline_runs.blob_url is not null
       and pipeline_runs.manual_review_status = 'pending'
     order by pipeline_runs.created_at desc`
  );
}

export async function setManualReviewStatus(
  runId: string,
  status: "published" | "skipped"
): Promise<void> {
  await query(`update pipeline_runs set manual_review_status = $2, updated_at = now() where id = $1`, [
    runId,
    status,
  ]);
}
