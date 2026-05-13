/**
 * Filing pipeline notifications.
 *
 * Sends email alerts to the SME when a declaration filing fails
 * and manual action is required before the 14-day deadline.
 */

import { getPostmarkClient } from "@/lib/postmark/client";

export interface FilingFailureNotificationArgs {
  /** Tenant email address */
  toEmail: string;
  /** Tenant company name */
  tenantName: string;
  declarationId: string;
  /** Machine-readable error code for the SME to quote in support */
  errorCode: string;
  /** Human-readable summary (no credentials) */
  errorSummary: string;
  /** ISO timestamp of the 14-day filing deadline, if known */
  filingDeadline?: string;
}

/**
 * Send a filing failure email to the tenant, instructing them to
 * file manually before their deadline.
 */
export async function sendFilingFailureNotification(
  args: FilingFailureNotificationArgs,
): Promise<void> {
  const fromEmail = process.env.POSTMARK_FROM_EMAIL;
  if (!fromEmail) {
    // Log a warning but do not throw — the email is advisory, not critical.
    console.warn(
      "[filing/notifications] POSTMARK_FROM_EMAIL is not set; " +
        "skipping failure notification for declaration " +
        args.declarationId,
    );
    return;
  }

  const client = getPostmarkClient();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://swiftdoc.app";
  const deadlineText = args.filingDeadline
    ? `Your filing deadline is ${new Date(args.filingDeadline).toLocaleDateString("en-HK", { timeZone: "Asia/Hong_Kong", dateStyle: "long" })}.`
    : "Please file as soon as possible to meet your 14-day deadline.";

  const htmlBody = `
<p>Dear ${escapeHtml(args.tenantName)},</p>

<p>SwiftDoc was unable to automatically file your Trade Declaration
(ID: <code>${escapeHtml(args.declarationId)}</code>) to the Tradelink portal after
multiple attempts.</p>

<p><strong>Error:</strong> ${escapeHtml(args.errorSummary)}<br/>
<strong>Reference code:</strong> <code>${escapeHtml(args.errorCode)}</code></p>

<p>${deadlineText}</p>

<p>Please log in to <a href="${appUrl}/declarations/${encodeURIComponent(args.declarationId)}">SwiftDoc</a>
to review the declaration and file it manually on the Tradelink portal,
or contact our support team quoting the reference code above.</p>

<p>— SwiftDoc</p>
`.trim();

  const textBody = `
Dear ${args.tenantName},

SwiftDoc was unable to automatically file your Trade Declaration
(ID: ${args.declarationId}) to the Tradelink portal after multiple attempts.

Error: ${args.errorSummary}
Reference code: ${args.errorCode}

${deadlineText}

Please log in to SwiftDoc at ${appUrl}/declarations/${args.declarationId}
to review the declaration and file it manually on the Tradelink portal,
or contact our support team quoting the reference code above.

— SwiftDoc
`.trim();

  await client.sendEmail({
    From: fromEmail,
    To: args.toEmail,
    Subject: `Action required: Manual filing needed for declaration ${args.declarationId}`,
    HtmlBody: htmlBody,
    TextBody: textBody,
    MessageStream:
      process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
