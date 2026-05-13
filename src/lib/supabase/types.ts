/**
 * Supabase database row types for SwiftDoc.
 * Derived from migrations: 20260513000001_declarations_schema.sql,
 * 20260513000002_filing_jobs.sql
 */

export type DeclarationStatus =
  | "pending"
  | "in_progress"
  | "filed"
  | "failed"
  | "manual_required";

export type FilingJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** TDEC declaration_data JSONB payload */
export interface DeclarationData {
  declarant_name?: string;
  shipment_ref?: string;
  declaration_type?: string;
  trade_date?: string;
  departure_date?: string;
  country_of_origin?: string;
  country_of_destination?: string;
  hs_code?: string;
  hkhs_code?: string;
  goods_description?: string;
  quantity?: number;
  unit?: string;
  value_hkd?: number;
  total_value_hkd?: number;
  duty_rate?: number;
  consignee?: string;
  [key: string]: unknown;
}

export interface Declaration {
  id: string;
  tenant_id: string;
  status: DeclarationStatus;
  declaration_data: DeclarationData;
  tradelink_ref: string | null;
  filing_deadline: string | null;
  created_at: string;
  updated_at: string;
  filed_at: string | null;
}

export interface AuditLogEntry {
  ts: string;
  stage: string;
  success: boolean;
  msg: string;
  metadata?: Record<string, unknown>;
}

export interface FilingJob {
  id: string;
  declaration_id: string;
  tenant_id: string;
  skyvern_task_id: string | null;
  skyvern_run_id: string | null;
  status: FilingJobStatus;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  last_error_msg: string | null;
  audit_log: AuditLogEntry[];
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  portal_ref: string | null;
}

/** Computed display status for the declarations table */
export type DisplayStatus = "OK" | "WARNING" | "CRITICAL" | "FILED" | "FAILED" | "IN_PROGRESS" | "MANUAL";

export function computeDisplayStatus(
  decl: Pick<Declaration, "status" | "filing_deadline">
): DisplayStatus {
  if (decl.status === "filed") return "FILED";
  if (decl.status === "failed") return "FAILED";
  if (decl.status === "in_progress") return "IN_PROGRESS";
  if (decl.status === "manual_required") return "MANUAL";

  // pending — check deadline proximity
  if (decl.filing_deadline) {
    const daysUntil =
      (new Date(decl.filing_deadline).getTime() - Date.now()) /
      (1000 * 60 * 60 * 24);
    if (daysUntil < 0 || daysUntil <= 3) return "CRITICAL";
    if (daysUntil <= 7) return "WARNING";
  }
  return "OK";
}
