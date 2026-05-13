/**
 * POST /api/filing/webhook
 *
 * Receives async status callbacks from Skyvern when a task reaches a
 * terminal state.  This endpoint is optional — the pipeline uses
 * synchronous polling as its primary completion mechanism.  This webhook
 * provides a faster, event-driven update path and reduces Skyvern API
 * polling load for long-running tasks.
 *
 * Skyvern calls this URL when:
 *   - A task completes (status: "completed")
 *   - A task fails (status: "failed" | "terminated" | "timed_out")
 *
 * The endpoint:
 *   1. Validates the Skyvern-Signature header (HMAC-SHA256).
 *   2. Looks up the filing_job by skyvern_task_id.
 *   3. If the job is already in a terminal state, returns 200 (idempotent).
 *   4. Otherwise updates the job + declaration to reflect the final outcome
 *      and appends a webhook audit entry.
 *
 * Environment variables:
 *   SKYVERN_WEBHOOK_SECRET – shared secret used to validate the HMAC
 *                            signature on incoming callbacks.  Set this
 *                            to any random 32-byte hex string and register
 *                            it in the Skyvern dashboard under webhook settings.
 *
 * NOTE: This webhook is registered per-task via the webhook_callback_url
 * field in buildTdecFilingTask().  It requires NEXT_PUBLIC_APP_URL to be
 * set so the absolute URL can be constructed.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFilingFailureNotification } from "@/lib/filing/notifications";
import {
  SKYVERN_SUCCESS_STATUSES,
  SKYVERN_TERMINAL_STATUSES,
  type SkyvernTaskResponse,
} from "@/lib/skyvern/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // ------------------------------------------------------------------
  // 1. Read raw body for signature validation before parsing
  // ------------------------------------------------------------------
  const rawBody = await req.text();

  // ------------------------------------------------------------------
  // 2. Validate HMAC signature if secret is configured
  // ------------------------------------------------------------------
  const webhookSecret = process.env.SKYVERN_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers.get("x-skyvern-signature") ?? "";
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
  }
  // If no secret is configured, accept unconditionally (log a warning in dev)
  else if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[api/filing/webhook] SKYVERN_WEBHOOK_SECRET is not set; " +
        "accepting unsigned webhook. Set the secret for production.",
    );
  } else {
    // In production, require the secret to be configured
    return NextResponse.json(
      { error: "SKYVERN_WEBHOOK_SECRET must be set in production" },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // 3. Parse payload
  // ------------------------------------------------------------------
  let task: SkyvernTaskResponse;
  try {
    task = JSON.parse(rawBody) as SkyvernTaskResponse;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!task?.task_id) {
    return NextResponse.json(
      { error: "Missing task_id in payload" },
      { status: 400 },
    );
  }

  // Only process terminal-state callbacks (ignore intermediate progress)
  if (!SKYVERN_TERMINAL_STATUSES.has(task.status)) {
    return NextResponse.json({ received: true, action: "ignored_non_terminal" });
  }

  // ------------------------------------------------------------------
  // 4. Look up the filing job
  // ------------------------------------------------------------------
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("filing_jobs")
    .select("id, declaration_id, tenant_id, status, retry_count, max_retries")
    .eq("skyvern_task_id", task.task_id)
    .maybeSingle();

  if (!job) {
    // Unknown task — may be from a different context; return 200 to avoid retries
    console.warn(
      `[api/filing/webhook] Received callback for unknown task ${task.task_id}`,
    );
    return NextResponse.json({ received: true, action: "job_not_found" });
  }

  // Idempotency: if already terminal, do nothing
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ received: true, action: "already_terminal" });
  }

  // ------------------------------------------------------------------
  // 5. Handle success
  // ------------------------------------------------------------------
  if (SKYVERN_SUCCESS_STATUSES.has(task.status)) {
    const tradelinkRef =
      task.extracted_information?.tradelink_ref ?? null;

    await admin
      .from("filing_jobs")
      .update({
        status: "completed",
        portal_ref: tradelinkRef,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    await admin
      .from("declarations")
      .update({
        status: "filed",
        tradelink_ref: tradelinkRef,
        filed_at: new Date().toISOString(),
      })
      .eq("id", job.declaration_id);

    // Use rpc to cleanly append the audit entry
    await admin.rpc("append_filing_job_audit_entry", {
      p_job_id: job.id,
      p_entry: {
        stage: "webhook_completed",
        success: true,
        msg: `Webhook: task ${task.task_id} completed`,
        metadata: { tradelink_ref: tradelinkRef },
      },
    });

    return NextResponse.json({ received: true, action: "filed" });
  }

  // ------------------------------------------------------------------
  // 6. Handle failure
  // ------------------------------------------------------------------
  const failureReason = task.failure_reason ?? "Unknown failure";
  const isFinalAttempt = job.retry_count >= job.max_retries;

  await admin
    .from("filing_jobs")
    .update({
      status: "failed",
      last_error_code: "SKYVERN_UNKNOWN_FAILURE",
      last_error_msg: failureReason.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await admin.rpc("append_filing_job_audit_entry", {
    p_job_id: job.id,
    p_entry: {
      stage: "webhook_failed",
      success: false,
      msg: `Webhook: task ${task.task_id} ${task.status}: ${failureReason}`,
      metadata: { skyvern_status: task.status, failure_reason: failureReason },
    },
  });

  const nextDeclarationStatus = isFinalAttempt ? "manual_required" : "failed";

  await admin
    .from("declarations")
    .update({ status: nextDeclarationStatus })
    .eq("id", job.declaration_id);

  // Send failure notification if this is the final attempt
  if (isFinalAttempt) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name, email")
      .eq("id", job.tenant_id)
      .single();

    const { data: declaration } = await admin
      .from("declarations")
      .select("filing_deadline")
      .eq("id", job.declaration_id)
      .single();

    if (tenant) {
      try {
        await sendFilingFailureNotification({
          toEmail: tenant.email,
          tenantName: tenant.name,
          declarationId: job.declaration_id,
          errorCode: "SKYVERN_UNKNOWN_FAILURE",
          errorSummary: failureReason,
          filingDeadline: declaration?.filing_deadline ?? undefined,
        });
      } catch (notifyErr) {
        console.error(
          "[api/filing/webhook] Notification failed:",
          notifyErr instanceof Error ? notifyErr.message : notifyErr,
        );
      }
    }
  }

  return NextResponse.json({
    received: true,
    action: isFinalAttempt ? "manual_required" : "failed_retryable",
  });
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Verify a Skyvern HMAC-SHA256 webhook signature.
 * Skyvern signs with: HMAC-SHA256(secret, rawBody) → hex
 */
function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf-8"),
      Buffer.from(expected, "utf-8"),
    );
  } catch {
    return false;
  }
}


