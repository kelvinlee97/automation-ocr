import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { readConfig } from "./config.js";
import { handleJob, MAX_JOB_ATTEMPTS } from "./jobs.js";
import { ReceiptProviderError } from "./providers/errors.js";

async function runOnce(supabase: any, config: ReturnType<typeof readConfig>) {
  const { data, error } = await supabase.rpc("claim_next_job", { p_worker_id: config.WORKER_ID });
  if (error) throw error;
  const job = Array.isArray(data) ? data[0] : data;
  if (!job) return false;
  if (!job.claim_token) throw new Error(`Job ${job.id} has no claim token`);

  const renewLease = setInterval(async () => {
    const { data: renewed, error: renewError } = await supabase.rpc("renew_job_lease", { p_job_id: job.id, p_claim_token: job.claim_token });
    if (renewError || renewed !== true) console.error(`Lease renewal failed for job ${job.id}`);
  }, 60_000);

  try {
    await handleJob(supabase, job, config);
    const { data: finished, error: updateError } = await supabase.rpc("finish_job", { p_job_id: job.id, p_claim_token: job.claim_token, p_status: "completed" });
    if (updateError || finished !== true) throw updateError ?? new Error(`Job ${job.id} lease was lost`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job error";
    const retry = !(error instanceof ReceiptProviderError) || error.retryable;
    const shouldRetry = retry && job.attempts < MAX_JOB_ATTEMPTS;
    await supabase.rpc("finish_job", {
      p_job_id: job.id,
      p_claim_token: job.claim_token,
      p_status: shouldRetry ? "queued" : "failed",
      p_last_error: message,
      p_available_at: shouldRetry ? new Date(Date.now() + 5000 * job.attempts).toISOString() : null
    });
    if (!shouldRetry) console.error(`Job ${job.id} failed permanently: ${message}`);
  } finally {
    clearInterval(renewLease);
  }
  return true;
}

export async function startWorker() {
  const config = readConfig();
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, worker: config.WORKER_ID }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(config.WORKER_PORT, "0.0.0.0");

  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await runOnce(supabase, config);
    } catch (error) {
      console.error("Worker poll failed", error);
    } finally {
      polling = false;
    }
  };
  await poll();
  setInterval(poll, config.WORKER_POLL_MS);
  console.log(`ClaimFlow worker ${config.WORKER_ID} listening on ${config.WORKER_PORT}`);
}

if (process.env.NODE_ENV !== "test") {
  void startWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
