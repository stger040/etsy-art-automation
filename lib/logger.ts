import { query } from "./db";

/**
 * Logs a step failure to pipeline_step_errors and stamps the run's
 * error_message, without throwing — callers use this from a catch block so
 * one failed external API call never aborts the rest of the cron run.
 */
export async function logStepError(params: {
  runId?: string | null;
  batchId?: string | null;
  step: string;
  error: unknown;
  detail?: Record<string, unknown>;
}) {
  const message = params.error instanceof Error ? params.error.message : String(params.error);

  console.error(`[pipeline:${params.step}]`, message, params.detail ?? "");

  try {
    await query(
      `insert into pipeline_step_errors (run_id, batch_id, step, error_message, detail)
       values ($1, $2, $3, $4, $5)`,
      [params.runId ?? null, params.batchId ?? null, params.step, message, params.detail ? JSON.stringify(params.detail) : null]
    );

    if (params.runId) {
      await query(
        `update pipeline_runs set error_message = $2, updated_at = now() where id = $1`,
        [params.runId, message]
      );
    }
  } catch (loggingError) {
    // If Postgres itself is unreachable, don't let logging failure mask the
    // original error or crash the run — just surface both to stdout.
    console.error("[pipeline:logger] failed to persist error log:", loggingError);
  }
}

/**
 * Runs `fn`, and if it throws, logs the failure via logStepError and returns
 * `null` instead of re-throwing, so the caller can decide how to proceed.
 */
export async function runStep<T>(
  step: string,
  ctx: { runId?: string | null; batchId?: string | null },
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    await logStepError({ ...ctx, step, error });
    return null;
  }
}
