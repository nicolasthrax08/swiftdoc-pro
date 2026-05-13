/**
 * Builds the Skyvern navigation goal and payload for a TDEC filing
 * against the Tradelink / Ge-TS portal.
 *
 * The navigation goal is a natural-language instruction that Skyvern's
 * vision-language model follows step-by-step.  Keep instructions
 * declarative and unambiguous.
 *
 * SECURITY: credentials are injected directly into navigation_payload
 * at call time and are never stored in any log or audit entry.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  TRADELINK STAGING ACCESS — PENDING                                  │
 * │                                                                      │
 * │  The TRADELINK_PORTAL_URL env var is currently a placeholder:        │
 * │    https://staging.tradelink.com.hk                                  │
 * │                                                                      │
 * │  Once staging credentials are granted, replace this with the real   │
 * │  Ge-TS / Tradelink staging portal URL in:                            │
 * │    - Vercel staging env: TRADELINK_PORTAL_URL                        │
 * │    - .env.local for local testing                                    │
 * │                                                                      │
 * │  Also review buildNavigationGoal() below — the step-by-step         │
 * │  instructions may need adjusting to match the actual portal UI.      │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { REVIEW_DECLARATION_APPROVAL_GATE_SCRIPT } from "@/lib/automation/payload";
import type { SkyvernCreateTaskRequest } from "@/lib/skyvern/types";
import type { TdecFormData } from "@/lib/skyvern/types";
import type { TradelinkCredential } from "./credentials";

// ---------------------------------------------------------------------------
// PLACEHOLDER — swap for the real Tradelink staging URL once access is granted
// ---------------------------------------------------------------------------
const TRADELINK_STAGING_URL_PLACEHOLDER = "https://staging.tradelink.com.hk";

/**
 * Returns the Tradelink portal URL from the TRADELINK_PORTAL_URL env var.
 *
 * IMPORTANT: TRADELINK_PORTAL_URL is currently set to the placeholder
 * "https://staging.tradelink.com.hk".  Replace it with the real Ge-TS
 * staging URL once Tradelink staging access is approved.
 */
function getTradeLinkPortalUrl(): string {
  const configured = process.env.TRADELINK_PORTAL_URL?.replace(/\/$/, "");
  if (!configured) {
    console.warn(
      `[filing/navigation] TRADELINK_PORTAL_URL is not set; ` +
        `falling back to placeholder ${TRADELINK_STAGING_URL_PLACEHOLDER}. ` +
        `Replace this with the real staging URL once access is granted.`,
    );
    return TRADELINK_STAGING_URL_PLACEHOLDER;
  }
  return configured;
}

/**
 * Construct the Skyvern CreateTaskRequest for a TDEC filing.
 *
 * @param cred     - decrypted Tradelink credentials (never logged)
 * @param formData - TDEC form fields from the declaration record
 * @param jobId    - filing_jobs.id — used in webhook URL for async callbacks
 */
export function buildTdecFilingTask(
  cred: TradelinkCredential,
  formData: TdecFormData,
  jobId: string,
): SkyvernCreateTaskRequest {
  const portalUrl = getTradeLinkPortalUrl();

  // Webhook for async status updates (optional, requires NEXT_PUBLIC_APP_URL)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const webhookUrl = appUrl
    ? `${appUrl}/api/filing/webhook?jobId=${jobId}`
    : undefined;

  return {
    url: portalUrl,

    navigation_goal: buildNavigationGoal(formData),

    data_extraction_goal:
      "If the automation stopped at the Review Declaration safety gate, return " +
      "{ review_declaration_pending: true, review_declaration_screenshot_url: '...' } " +
      "when a screenshot URL is available (omit the URL key if not). " +
      "After a successful full submission past Review, extract the Tradelink / Ge-TS " +
      "confirmation reference as { tradelink_ref: '...' }. " +
      "If the submission failed, return the displayed error message as { error: '...' }.",

    extracted_information_schema: {
      type: "object",
      properties: {
        tradelink_ref: { type: "string" },
        error: { type: "string" },
        review_declaration_pending: { type: "boolean" },
        review_declaration_screenshot_url: { type: "string" },
      },
    },

    // All field values that Skyvern should fill into the form.
    // Credentials are included here; they MUST NOT be logged.
    navigation_payload: {
      username: cred.username,
      password: cred.password,
      ...sanitisedFormPayload(formData),
    },

    // Error code mapping — Skyvern classifies portal error messages
    // into these machine-readable codes returned in failure_reason.
    error_code_mapping: {
      "Invalid username or password": "AUTH_FAILED",
      "Session expired": "SESSION_EXPIRED",
      "HS code not found": "INVALID_HS_CODE",
      "Invalid HS code": "INVALID_HS_CODE",
      "Missing required field": "MISSING_FIELD",
      "Duplicate declaration": "DUPLICATE_DECLARATION",
      "System maintenance": "PORTAL_MAINTENANCE",
    },

    // Allow up to 50 navigation steps for a multi-page TDEC form
    max_steps_override: 50,

    webhook_callback_url: webhookUrl,
  };
}

// ----------------------------------------------------------------
// Private helpers
// ----------------------------------------------------------------

function buildNavigationGoal(formData: TdecFormData): string {
  const adValoremLine =
    formData.ad_valorem_tax_hkd != null
      ? "   - Ad valorem tax (HKD): navigation_payload.ad_valorem_tax_hkd"
      : null;

  const lines = [
    "1. Navigate to the Tradelink / Ge-TS portal login page.",
    "2. Enter the username from navigation_payload.username and password " +
      "from navigation_payload.password into the login form and click Login.",
    "3. If login fails, stop immediately and report AUTH_FAILED.",
    "4. After a successful login, navigate to the Trade Declaration " +
      "(TDEC) submission page.",
    `5. Select declaration type: ${formData.declaration_type}.`,
    "6. Fill in all form fields using the values in navigation_payload:",
    "   - Declarant name: navigation_payload.declarant_name",
    "   - Shipment reference: navigation_payload.shipment_ref",
    "   - Trade date: navigation_payload.trade_date",
    "   - Country of origin: navigation_payload.country_of_origin",
    "   - Country of destination: navigation_payload.country_of_destination",
    "   - HS code: navigation_payload.hs_code",
    adValoremLine,
    "   - Goods description: navigation_payload.goods_description",
    "   - Quantity: navigation_payload.quantity",
    "   - Unit: navigation_payload.unit",
    "   - Declared value (HKD): navigation_payload.value_hkd",
    "7. Advance through the wizard until the \"Review Declaration\" screen " +
      "(final review / summary immediately before any control that transmits the filing).",
    "8. Execute the SAFETY GATE instructions below — do not finalise the declaration without human approval.",
  ].filter((line): line is string => line != null);

  return `${lines.join("\n")}\n\n${REVIEW_DECLARATION_APPROVAL_GATE_SCRIPT}`;
}

function sanitisedFormPayload(
  formData: TdecFormData,
): Record<string, unknown> {
  // Spread all form fields EXCEPT any that might accidentally contain
  // credential-like keys.  Explicit allow-list is safer than denylist.
  const {
    declarant_name,
    shipment_ref,
    declaration_type,
    trade_date,
    country_of_origin,
    country_of_destination,
    hs_code,
    goods_description,
    quantity,
    unit,
    value_hkd,
    ad_valorem_tax_hkd,
    duty_rate,
  } = formData;

  return {
    declarant_name,
    shipment_ref,
    declaration_type,
    trade_date,
    country_of_origin,
    country_of_destination,
    hs_code,
    goods_description,
    quantity,
    unit,
    value_hkd,
    ...(ad_valorem_tax_hkd !== undefined
      ? { ad_valorem_tax_hkd }
      : {}),
    ...(duty_rate !== undefined ? { duty_rate } : {}),
  };
}
