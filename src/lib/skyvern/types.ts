/**
 * Skyvern API types for SwiftDoc filing pipeline.
 *
 * Ref: https://docs.skyvern.com/api-reference
 */

// ----------------------------------------------------------------
// Skyvern task statuses
// ----------------------------------------------------------------
export type SkyvernTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "terminated"
  | "cancelled"
  | "timed_out";

export const SKYVERN_TERMINAL_STATUSES = new Set<SkyvernTaskStatus>([
  "completed",
  "failed",
  "terminated",
  "cancelled",
  "timed_out",
]);

export const SKYVERN_SUCCESS_STATUSES = new Set<SkyvernTaskStatus>([
  "completed",
]);

// ----------------------------------------------------------------
// Skyvern API request/response shapes
// ----------------------------------------------------------------
export interface SkyvernCreateTaskRequest {
  url: string;
  navigation_goal: string;
  data_extraction_goal?: string;
  navigation_payload?: Record<string, unknown>;
  extracted_information_schema?: Record<string, unknown>;
  error_code_mapping?: Record<string, string>;
  max_steps_override?: number;
  webhook_callback_url?: string;
  totp_verification_url?: string;
  totp_identifier?: string;
  proxy_location?: string;
}

export interface SkyvernTaskResponse {
  task_id: string;
  status: SkyvernTaskStatus;
  url: string;
  navigation_goal: string;
  created_at: string;
  modified_at: string;
  extracted_information?: SkyvernExtractedInformation | null;
  failure_reason?: string | null;
  errors?: SkyvernTaskError[];
}

export interface SkyvernExtractedInformation {
  /**
   * The Tradelink / Ge-TS confirmation reference number returned
   * after a successful TDEC submission.
   */
  tradelink_ref?: string | null;
  confirmation_screenshot_url?: string | null;
  raw?: unknown;
}

export interface SkyvernTaskError {
  type: string;
  description: string;
  /** Whether this error is retryable (transient) */
  retryable?: boolean;
}

// ----------------------------------------------------------------
// Filing pipeline types
// ----------------------------------------------------------------

/** Structured error codes used across the pipeline */
export type FilingErrorCode =
  | "CREDENTIAL_NOT_FOUND"
  | "CREDENTIAL_VAULT_ERROR"
  | "SKYVERN_TASK_CREATION_FAILED"
  | "SKYVERN_AUTH_FAILED"
  | "SKYVERN_FORM_ERROR"
  | "SKYVERN_TIMEOUT"
  | "SKYVERN_UNKNOWN_FAILURE"
  | "DECLARATION_NOT_FOUND"
  | "DECLARATION_INVALID_STATE"
  | "POLLING_EXHAUSTED"
  | "INTERNAL_ERROR";

export interface FilingPipelineResult {
  success: boolean;
  jobId: string;
  declarationId: string;
  /**
   * Populated on success — the Tradelink reference number captured
   * from the portal after submission.
   */
  tradelinkRef?: string;
  errorCode?: FilingErrorCode;
  /** A safe summary — never contains raw credentials */
  errorMsg?: string;
}

/** TDEC form fields extracted from declaration_data */
export interface TdecFormData {
  /** Declarant company name */
  declarant_name: string;
  /** Tradelink reference or internal shipment ID */
  shipment_ref: string;
  /** Trade declaration type, e.g. "EXPORT", "IMPORT" */
  declaration_type: string;
  /** ISO date string: date of export/import */
  trade_date: string;
  /** Country of origin (ISO 3166-1 alpha-2) */
  country_of_origin: string;
  /** Country of destination (ISO 3166-1 alpha-2) */
  country_of_destination: string;
  /** HS code resolved by Gemini */
  hs_code: string;
  /** Goods description */
  goods_description: string;
  /** Quantity */
  quantity: number;
  /** Unit of measure */
  unit: string;
  /** CIF / FOB value in HKD */
  value_hkd: number;
  /** Ad valorem duty rate (0–1, e.g. 0.05 = 5%) */
  duty_rate?: number;
  /** Additional fields passed through to the portal */
  [key: string]: unknown;
}
