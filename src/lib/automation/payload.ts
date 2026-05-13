/**
 * TDEC export automation — Vault-backed payload builder.
 *
 * Server-only: loads platform `TRADELINK_ID` / `TRADELINK_PASS` from Supabase Vault.
 * Never send the returned object to the browser or serialise credentials to logs.
 */

import { calculateAdValorem, validateHKHSCode } from "@/lib/compliance";
import type { WaybillExtractionResult } from "@/lib/waybill/extract";
import {
  getTradelinkVaultCredentials,
  type TradelinkVaultCredentials,
} from "@/lib/vault";

export const TRADELINK_STAGING_SKYVERN_TARGET =
  "tradelink-staging-portal" as const;

/**
 * Natural-language block to append to Skyvern `navigation_goal`.
 * Instructs the agent to halt on the Review Declaration screen, screenshot,
 * and not submit until a human approves.
 */
export const REVIEW_DECLARATION_APPROVAL_GATE_SCRIPT = [
  "─── SAFETY GATE: REVIEW DECLARATION (HUMAN APPROVAL) ───",
  'When the portal shows the "Review Declaration" step (or equivalent final review / preview / summary immediately BEFORE any control that transmits the declaration to Customs):',
  "1. STOP. Do not click Submit, Confirm, Send to Government, or any control that finalises the filing.",
  "2. Take a full-page screenshot of the Review Declaration screen (scroll as needed so HS/HKHS code, declared values, and Ad Valorem tax are visible).",
  "3. Populate extracted_information with review_declaration_pending: true and, if the platform provides a screenshot artifact URL, review_declaration_screenshot_url.",
  "4. End this automation run without submitting. Wait for explicit human approval before any follow-up task continues past Review.",
].join("\n");

// ---------------------------------------------------------------------------
// Validated waybill (structural + HKHS checks)
// ---------------------------------------------------------------------------

export interface ValidatedWaybillRecord {
  extractionId: string;
  consignee: string;
  departure_date: string;
  total_value_hkd: number;
  hkhs_code: string;
  confidence_score: number | null;
}

export class WaybillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaybillValidationError";
  }
}

export class AutomationPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationPayloadValidationError";
  }
}

/**
 * Turn a persisted extraction into a validated record, or throw with a clear reason.
 */
export function toValidatedWaybillRecord(
  extraction: WaybillExtractionResult,
): ValidatedWaybillRecord {
  const { extractionId, consignee, departure_date, total_value_hkd, hkhs_code } =
    extraction;

  if (!consignee?.trim()) {
    throw new WaybillValidationError("consignee is required");
  }
  if (!departure_date?.trim()) {
    throw new WaybillValidationError("departure_date is required");
  }
  if (total_value_hkd == null || total_value_hkd < 0) {
    throw new WaybillValidationError(
      "total_value_hkd must be a non-negative number",
    );
  }
  if (!hkhs_code?.trim()) {
    throw new WaybillValidationError("hkhs_code is required");
  }

  const hs = validateHKHSCode(hkhs_code.trim());
  if (!hs.valid) {
    throw new WaybillValidationError(hs.error ?? "invalid hkhs_code");
  }

  return {
    extractionId,
    consignee: consignee.trim(),
    departure_date: departure_date.trim(),
    total_value_hkd,
    hkhs_code: hkhs_code.trim(),
    confidence_score: extraction.confidence_score,
  };
}

// ---------------------------------------------------------------------------
// TDEC export field mapping (HKHS + ad valorem)
// ---------------------------------------------------------------------------

/**
 * TDEC export form fields derived from validated compliance inputs.
 *
 * - `hs_code` — Tradelink / TDEC commodity field (8-digit HKHS).
 * - `ad_valorem_tax_hkd` — Ad valorem fee in HKD (matches DB `ad_valorem_tax`).
 */
export interface TdecExportFormFields {
  hs_code: string;
  ad_valorem_tax_hkd: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Map validated 8-digit `hkhs_code` and computed `ad_valorem_tax` into TDEC export
 * payload keys consumed by the browser agent (`navigation_payload`).
 */
export function mapValidatedCodesToTdecExportFields(
  hkhs_code: string,
  ad_valorem_tax: number,
): TdecExportFormFields {
  const trimmed = hkhs_code.trim();
  const hs = validateHKHSCode(trimmed);
  if (!hs.valid) {
    throw new AutomationPayloadValidationError(
      hs.error ?? "hkhs_code must be exactly 8 digits",
    );
  }
  if (!Number.isFinite(ad_valorem_tax) || ad_valorem_tax < 0) {
    throw new AutomationPayloadValidationError(
      "ad_valorem_tax must be a non-negative finite number",
    );
  }
  return {
    hs_code: trimmed,
    ad_valorem_tax_hkd: round2(ad_valorem_tax),
  };
}

// ---------------------------------------------------------------------------
// Full automation payload (Vault + TDEC fields + Skyvern merge helpers)
// ---------------------------------------------------------------------------

export interface TdecExportAutomationPayload {
  credentials: TradelinkVaultCredentials;
  waybill: ValidatedWaybillRecord;
  tdec_export_fields: TdecExportFormFields;
  /** Append to Skyvern `navigation_goal` after login / form-fill steps */
  agent_review_declaration_gate_script: string;
  /**
   * Spread into Skyvern `navigation_payload` alongside other TDEC fields.
   * Uses `username` / `password` keys expected by filing/navigation goals.
   */
  skyvern_navigation_payload: Record<string, unknown>;
}

export interface BuildTdecExportAutomationInput {
  waybill: ValidatedWaybillRecord;
  /** If omitted, ad valorem is derived from `waybill.total_value_hkd` via compliance rules */
  ad_valorem_tax?: number;
}

function buildSkyvernNavigationPayload(
  credentials: TradelinkVaultCredentials,
  waybill: ValidatedWaybillRecord,
  tdec: TdecExportFormFields,
): Record<string, unknown> {
  return {
    username: credentials.tradelinkId,
    password: credentials.tradelinkPass,
    hs_code: tdec.hs_code,
    ad_valorem_tax_hkd: tdec.ad_valorem_tax_hkd,
    trade_date: waybill.departure_date,
    value_hkd: waybill.total_value_hkd,
    consignee: waybill.consignee,
    waybill_extraction_id: waybill.extractionId,
  };
}

/**
 * Fetch Vault credentials, validate HKHS + tax, and produce TDEC export mappings
 * plus Skyvern-ready navigation payload and the Review Declaration safety script.
 */
export async function buildTdecExportAutomationPayload(
  input: BuildTdecExportAutomationInput,
): Promise<TdecExportAutomationPayload> {
  const credentials = await getTradelinkVaultCredentials();
  const adValorem =
    input.ad_valorem_tax !== undefined
      ? input.ad_valorem_tax
      : calculateAdValorem(input.waybill.total_value_hkd).tax;

  const tdec_export_fields = mapValidatedCodesToTdecExportFields(
    input.waybill.hkhs_code,
    adValorem,
  );

  return {
    credentials,
    waybill: input.waybill,
    tdec_export_fields,
    agent_review_declaration_gate_script:
      REVIEW_DECLARATION_APPROVAL_GATE_SCRIPT,
    skyvern_navigation_payload: buildSkyvernNavigationPayload(
      credentials,
      input.waybill,
      tdec_export_fields,
    ),
  };
}

/**
 * Single JSON-serialisable body for a Skyvern browser-agent HTTP POST: portal target,
 * Vault-resolved Tradelink credentials (plaintext to the service role after Vault
 * decryption), and validated waybill fields.
 */
export interface SkyvernBrowserAgentPostPayload {
  target: typeof TRADELINK_STAGING_SKYVERN_TARGET;
  credentials: TradelinkVaultCredentials;
  waybill: ValidatedWaybillRecord;
}

/**
 * Merge validated waybill data with Vault credentials into one object for
 * `JSON.stringify` / Skyvern browser-agent POST.
 */
export async function buildSkyvernBrowserAgentPostPayload(
  waybill: ValidatedWaybillRecord,
): Promise<SkyvernBrowserAgentPostPayload> {
  const credentials = await getTradelinkVaultCredentials();

  return {
    target: TRADELINK_STAGING_SKYVERN_TARGET,
    credentials,
    waybill,
  };
}

/** @deprecated Use {@link SkyvernBrowserAgentPostPayload} */
export type TradelinkStagingSkyvernPayload = SkyvernBrowserAgentPostPayload;

/**
 * @deprecated Use {@link buildSkyvernBrowserAgentPostPayload}. TDEC field mapping and
 * review gate are in {@link buildTdecExportAutomationPayload}.
 */
export async function buildTradelinkStagingSkyvernPayload(
  waybill: ValidatedWaybillRecord,
): Promise<SkyvernBrowserAgentPostPayload> {
  return buildSkyvernBrowserAgentPostPayload(waybill);
}
