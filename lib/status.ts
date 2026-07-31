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

const DIGITAL_STEPS = ["canva_mockup", "etsy_create_draft_listing", "etsy_upload_digital_file", "etsy_upload_listing_image"];
const PHYSICAL_STEPS = ["printify_create_and_publish"];

export type ManualQueueItem = PipelineRun & {
  niche_name: string | null;
  digital_failed: boolean;
  physical_failed: boolean;
};

/**
 * Designs that finished generation + compliance approval but failed to
 * auto-publish on a branch that was actually attempted, and haven't been
 * handled through the manual fallback flow yet. Checks per-branch step
 * errors (not just overall run status) so a partial failure — e.g. digital
 * publishes fine but physical fails — still surfaces here even though the
 * run's overall status is 'completed'. A branch that was simply disabled
 * (PIPELINE_ENABLE_DIGITAL/PHYSICAL=false) never logs a step error, so it
 * correctly won't show up as needing manual attention.
 */
export async function getManualQueue(): Promise<ManualQueueItem[]> {
  return query<ManualQueueItem>(
    `select
       pipeline_runs.*,
       niches.name as niche_name,
       exists (
         select 1 from pipeline_step_errors
         where pipeline_step_errors.run_id = pipeline_runs.id and pipeline_step_errors.step = any($1)
       ) as digital_failed,
       exists (
         select 1 from pipeline_step_errors
         where pipeline_step_errors.run_id = pipeline_runs.id and pipeline_step_errors.step = any($2)
       ) as physical_failed
     from pipeline_runs
     left join niches on niches.id = pipeline_runs.niche_id
     where pipeline_runs.blob_url is not null
       and pipeline_runs.manual_review_status = 'pending'
       and exists (
         select 1 from pipeline_step_errors
         where pipeline_step_errors.run_id = pipeline_runs.id
           and pipeline_step_errors.step = any($1 || $2)
       )
     order by pipeline_runs.created_at desc`,
    [DIGITAL_STEPS, PHYSICAL_STEPS]
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
