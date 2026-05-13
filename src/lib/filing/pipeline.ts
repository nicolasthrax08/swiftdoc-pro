/**
 * Skyvern Agentic Filing Pipeline — core orchestrator.
 *
 * Stages:
 *  1. Validate the declaration record and check it is in a fileable state.
 *  2. Retrieve Tradelink credentials from Supabase Vault (service-role RPC).
 *  3. Create a filing_jobs row and mark the declaration as in_progress.
 *  4. Submit a Skyvern browser-agent task.
 *  5. Poll Skyvern until the task reaches a terminal status.
 *  6. On success: store tradelink_ref, mark declaration as filed.
 *  7. On retryable failure: increment retry_count and re-attempt.
 *  8. On terminal failure: mark declaration as failed/manual_required,
 *     send failure notification email to the tenant.
 *
 * SECURITY: credentials flow only through getTradelinkCredential() and
 * buildTdecFilingTask().  They are never written to audit_log or any
 * other persistent store.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTradelinkCredential,
  CredentialError,
} from "./credentials";
import { buildTdecFilingTask } from "./navigation";
import { sendFilingFailureNotification } from "./notifications";
import {
  createSkyvernTask,
  pollSkyvernTask,
  SkyvernApiError,
} from "@/lib/skyvern/client";
import {
  SKYVERN_SUCCESS_STATUSES,
  type FilingErrorCode,
  type FilingPipelineResult,
  type TdecFormData,
} from "@/lib/skyvern/types";

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const MAX_RETRIES = 3;
// Non-retryable portal-level error codes (from error_code_mapping in navigation.ts)
const NON_RETRYABLE_PORTAL_ERRORS = new Set([
  "AUTH_FAILED",
  "INVALID_HS_CODE",
  "MISSING_FIELD",
  "DUPLICATE_DECLARATION",
]);

// ----------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------

/**
 * Run the complete filing pipeline for a given declaration.
 *
 * This function is idempotent when called with the same declaration_id:
 * if a job is already in_progress it returns the existing job ID.
 * If a prior job failed and retry_count < MAX_RETRIES it creates a new attempt.
 *
 * @param declarationId - UUID of the declarations row to file
 */
export async function runFilingPipeline(
  declarationId: string,
): Promise<FilingPipelineResult> {
  const admin = createAdminClient();

  // ------------------------------------------------------------------
  // 1. Load declaration
  // ------------------------------------------------------------------
  const { data: declaration, error: decError } = await admin
    .from("declarations")
    .select(
      "id, tenant_id, status, declaration_data, filing_deadline, tradelink_ref",
    )
    .eq("id", declarationId)
    .single();

  if (decError || !declaration) {
    return pipelineError(
      declarationId,
      "STUB",
      "DECLARATION_NOT_FOUND",
      `Declaration ${declarationId} not found`,
    );
  }

  // Only file if in a valid pre-filing state
  if (!["pending", "failed"].includes(declaration.status)) {
    if (declaration.status === "filed") {
      return {
        success: true,
        jobId: "ALREADY_FILED",
        declarationId,
        tradelinkRef: declaration.tradelink_ref ?? undefined,
      };
    }
    return pipelineError(
      declarationId,
      "STUB",
      "DECLARATION_INVALID_STATE",
      `Declaration is in state '${declaration.status}'; cannot file`,
    );
  }

  // ------------------------------------------------------------------
  // 2. Load tenant info (for notifications)
  // ------------------------------------------------------------------
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, email")
    .eq("id", declaration.tenant_id)
    .single();

  // ------------------------------------------------------------------
  // 3. Check for existing in-progress job (idempotency)
  // ------------------------------------------------------------------
  const { data: existingJob } = await admin
    .from("filing_jobs")
    .select("id, status, retry_count")
    .eq("declaration_id", declarationId)
    .eq("status", "running")
    .order("queued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJob) {
    return {
      success: false,
      jobId: existingJob.id,
      declarationId,
      errorCode: undefined,
      errorMsg: "A filing job is already running for this declaration",
    };
  }

  // Count previous attempts
  const { count: attemptCount } = await admin
    .from("filing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("declaration_id", declarationId);

  const retryCount = attemptCount ?? 0;

  // ------------------------------------------------------------------
  // 4. Create filing_jobs row (queued)
  // ------------------------------------------------------------------
  const { data: job, error: jobError } = await admin
    .from("filing_jobs")
    .insert({
      declaration_id: declarationId,
      tenant_id: declaration.tenant_id,
      status: "queued",
      retry_count: retryCount,
      max_retries: MAX_RETRIES,
      audit_log: [
        {
          ts: new Date().toISOString(),
          stage: "pipeline_start",
          success: true,
          msg: `Filing attempt ${retryCount + 1} of ${MAX_RETRIES + 1} started`,
        },
      ],
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return pipelineError(
      declarationId,
      "STUB",
      "INTERNAL_ERROR",
      "Failed to create filing_jobs row",
    );
  }

  const jobId = job.id;

  // Mark declaration as in_progress
  await admin
    .from("declarations")
    .update({ status: "in_progress" })
    .eq("id", declarationId);

  // ------------------------------------------------------------------
  // 5. Retrieve credentials from Vault
  // ------------------------------------------------------------------
  let cred;
  try {
    cred = await getTradelinkCredential(declaration.tenant_id);
    await appendAudit(admin, jobId, {
      stage: "credential_retrieval",
      success: true,
      msg: "Tradelink credentials retrieved from Vault",
    });
  } catch (err) {
    const code =
      err instanceof CredentialError ? err.code : "CREDENTIAL_VAULT_ERROR";
    const msg =
      err instanceof CredentialError
        ? err.message
        : "Vault credential retrieval failed";

    await failJob(admin, jobId, declarationId, code, msg);

    // Credential errors are not retryable; go straight to manual_required
    const isFinalAttempt = retryCount >= MAX_RETRIES;
    if (isFinalAttempt && tenant) {
      await notifyManualRequired(tenant, declarationId, code, msg, declaration.filing_deadline);
    }
    if (isFinalAttempt) {
      await admin
        .from("declarations")
        .update({ status: "manual_required" })
        .eq("id", declarationId);
    } else {
      await admin
        .from("declarations")
        .update({ status: "failed" })
        .eq("id", declarationId);
    }

    return pipelineError(declarationId, jobId, code as FilingErrorCode, msg);
  }

  // ------------------------------------------------------------------
  // 6. Build and submit Skyvern task
  // ------------------------------------------------------------------
  const formData = declaration.declaration_data as TdecFormData;
  const taskRequest = buildTdecFilingTask(cred, formData, jobId);

  // Zero out the credential reference immediately — we don't need it again
  cred = null;

  let skyvernTask;
  try {
    skyvernTask = await createSkyvernTask(taskRequest);
    await appendAudit(admin, jobId, {
      stage: "skyvern_task_created",
      success: true,
      msg: `Skyvern task ${skyvernTask.task_id} created`,
      metadata: { skyvern_task_id: skyvernTask.task_id },
    });

    // Persist task ID on the job row
    await admin
      .from("filing_jobs")
      .update({
        skyvern_task_id: skyvernTask.task_id,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    const isRetryable =
      err instanceof SkyvernApiError ? err.isRetryable : true;
    const msg =
      err instanceof Error ? err.message : "Skyvern task creation failed";

    await failJob(
      admin,
      jobId,
      declarationId,
      "SKYVERN_TASK_CREATION_FAILED",
      msg,
    );

    const isFinalAttempt = retryCount >= MAX_RETRIES || !isRetryable;
    await setDeclarationFinalStatus(
      admin,
      declarationId,
      isFinalAttempt,
      tenant,
      "SKYVERN_TASK_CREATION_FAILED",
      msg,
      declaration.filing_deadline,
    );

    return pipelineError(
      declarationId,
      jobId,
      "SKYVERN_TASK_CREATION_FAILED",
      msg,
    );
  }

  // ------------------------------------------------------------------
  // 7. Poll until terminal status
  // ------------------------------------------------------------------
  let finalTask;
  try {
    finalTask = await pollSkyvernTask(skyvernTask.task_id, {
      maxAttempts: 72,    // 72 × 5s = 6 minutes
      intervalMs: 5_000,
      onPoll: async (task, attempt) => {
        if (attempt % 6 === 0) {
          // Every 30s write a heartbeat entry to audit_log
          await appendAudit(admin, jobId, {
            stage: "polling_heartbeat",
            success: true,
            msg: `Status: ${task.status} (poll #${attempt})`,
          });
        }
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Polling failed";
    await failJob(admin, jobId, declarationId, "POLLING_EXHAUSTED", msg);
    const isFinalAttempt = retryCount >= MAX_RETRIES;
    await setDeclarationFinalStatus(
      admin,
      declarationId,
      isFinalAttempt,
      tenant,
      "SKYVERN_TIMEOUT",
      msg,
      declaration.filing_deadline,
    );
    return pipelineError(declarationId, jobId, "POLLING_EXHAUSTED", msg);
  }

  // ------------------------------------------------------------------
  // 8. Evaluate outcome
  // ------------------------------------------------------------------
  if (SKYVERN_SUCCESS_STATUSES.has(finalTask.status)) {
    const tradelinkRef =
      finalTask.extracted_information?.tradelink_ref ?? undefined;

    await appendAudit(admin, jobId, {
      stage: "filing_completed",
      success: true,
      msg: `Declaration filed. Tradelink ref: ${tradelinkRef ?? "not captured"}`,
      metadata: { tradelink_ref: tradelinkRef },
    });

    // Mark job completed
    await admin
      .from("filing_jobs")
      .update({
        status: "completed",
        portal_ref: tradelinkRef ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Mark declaration filed
    await admin
      .from("declarations")
      .update({
        status: "filed",
        tradelink_ref: tradelinkRef ?? null,
        filed_at: new Date().toISOString(),
      })
      .eq("id", declarationId);

    return {
      success: true,
      jobId,
      declarationId,
      tradelinkRef,
    };
  }

  // Task failed — determine if it is retryable
  const failureReason = finalTask.failure_reason ?? "Unknown failure";
  const portalErrorCode = extractPortalErrorCode(failureReason);
  const isNonRetryable = portalErrorCode
    ? NON_RETRYABLE_PORTAL_ERRORS.has(portalErrorCode)
    : false;
  const isFinalAttempt = retryCount >= MAX_RETRIES || isNonRetryable;

  const filingErrorCode = mapPortalErrorToCode(portalErrorCode);

  await appendAudit(admin, jobId, {
    stage: "filing_failed",
    success: false,
    msg: `Skyvern task ${finalTask.status}: ${failureReason}`,
    metadata: {
      skyvern_status: finalTask.status,
      portal_error_code: portalErrorCode,
      failure_reason: failureReason,
    },
  });

  await failJob(admin, jobId, declarationId, filingErrorCode, failureReason);
  await setDeclarationFinalStatus(
    admin,
    declarationId,
    isFinalAttempt,
    tenant,
    filingErrorCode,
    failureReason,
    declaration.filing_deadline,
  );

  return pipelineError(declarationId, jobId, filingErrorCode, failureReason);
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

async function appendAudit(
  admin: AdminClient,
  jobId: string,
  entry: {
    stage: string;
    success: boolean;
    msg: string;
    metadata?: Record<string, unknown>;
  },
) {
  await admin.rpc("append_filing_job_audit_entry", {
    p_job_id: jobId,
    p_entry: entry,
  });
}

async function failJob(
  admin: AdminClient,
  jobId: string,
  declarationId: string,
  errorCode: string,
  errorMsg: string,
) {
  await admin
    .from("filing_jobs")
    .update({
      status: "failed",
      last_error_code: errorCode,
      // Truncate to 500 chars and strip any credential-shaped content
      last_error_msg: sanitiseErrorMsg(errorMsg).slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function setDeclarationFinalStatus(
  admin: AdminClient,
  declarationId: string,
  isFinalAttempt: boolean,
  tenant: { name: string; email: string } | null | undefined,
  errorCode: string,
  errorMsg: string,
  filingDeadline?: string | null,
) {
  if (isFinalAttempt) {
    await admin
      .from("declarations")
      .update({ status: "manual_required" })
      .eq("id", declarationId);

    if (tenant) {
      await notifyManualRequired(
        tenant,
        declarationId,
        errorCode,
        errorMsg,
        filingDeadline ?? undefined,
      );
    }
  } else {
    await admin
      .from("declarations")
      .update({ status: "failed" })
      .eq("id", declarationId);
  }
}

async function notifyManualRequired(
  tenant: { name: string; email: string },
  declarationId: string,
  errorCode: string,
  errorMsg: string,
  filingDeadline?: string | null,
) {
  try {
    await sendFilingFailureNotification({
      toEmail: tenant.email,
      tenantName: tenant.name,
      declarationId,
      errorCode,
      errorSummary: sanitiseErrorMsg(errorMsg),
      filingDeadline: filingDeadline ?? undefined,
    });
  } catch (notifyErr) {
    // Notification failure must not propagate — log and continue
    console.error(
      "[filing/pipeline] Failed to send failure notification:",
      notifyErr instanceof Error ? notifyErr.message : notifyErr,
    );
  }
}

function pipelineError(
  declarationId: string,
  jobId: string,
  errorCode: FilingErrorCode,
  errorMsg: string,
): FilingPipelineResult {
  return {
    success: false,
    jobId,
    declarationId,
    errorCode,
    errorMsg: sanitiseErrorMsg(errorMsg),
  };
}

/**
 * Strip anything that looks like a credential (password= / Authorization: / Bearer)
 * from an error message before it is stored or returned to a client.
 */
function sanitiseErrorMsg(msg: string): string {
  return msg
    .replace(/password\s*[:=]\s*\S+/gi, "password=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/x-api-key\s*[:=]\s*\S+/gi, "x-api-key=[REDACTED]");
}

/**
 * Extract a machine-readable portal error code from a Skyvern failure_reason.
 * The codes come from the error_code_mapping we set in the task request.
 */
function extractPortalErrorCode(failureReason: string): string | null {
  const known = [
    "AUTH_FAILED",
    "SESSION_EXPIRED",
    "INVALID_HS_CODE",
    "MISSING_FIELD",
    "DUPLICATE_DECLARATION",
    "PORTAL_MAINTENANCE",
  ];
  for (const code of known) {
    if (failureReason.includes(code)) return code;
  }
  return null;
}

function mapPortalErrorToCode(portalCode: string | null): FilingErrorCode {
  switch (portalCode) {
    case "AUTH_FAILED":
    case "SESSION_EXPIRED":
      return "SKYVERN_AUTH_FAILED";
    case "INVALID_HS_CODE":
    case "MISSING_FIELD":
      return "SKYVERN_FORM_ERROR";
    default:
      return "SKYVERN_UNKNOWN_FAILURE";
  }
}
