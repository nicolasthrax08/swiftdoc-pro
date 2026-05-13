/**
 * POST /api/compliance/validate
 *
 * Performs a full pre-submission compliance check for a TDEC declaration:
 *   - HKHS code validation (must be exactly 8 digits)
 *   - Ad valorem tax calculation (0.3% with HK$0.20 floor)
 *   - 14-day filing deadline status check
 *
 * Request body (JSON):
 *   {
 *     hkhs_code:       string   — 8-digit Harmonized System code
 *     total_value_hkd: number   — total declared CIF value in HKD
 *     departure_date:  string   — ISO 8601 date of cargo departure
 *   }
 *
 * Response 200 (all checks pass):
 *   {
 *     compliant: true,
 *     hkhs:     { valid: true },
 *     tax:      { tax, rate, floor_applied },
 *     deadline: { status, days_remaining, days_elapsed }
 *   }
 *
 * Response 422 (one or more checks fail):
 *   {
 *     compliant: false,
 *     hkhs:     { valid: boolean, error? },
 *     tax:      { tax, rate, floor_applied } | null,
 *     deadline: { status, days_remaining, days_elapsed } | null,
 *     errors:   string[]   — human-readable list of compliance failures
 *   }
 *
 * Response 400: malformed request body
 * Response 500: unexpected server error
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  calculateAdValorem,
  checkDeadlineStatus,
  validateHKHSCode,
} from "@/lib/compliance";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // ------------------------------------------------------------------
  // Parse body
  // ------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Request body must be JSON");
  }

  if (!body || typeof body !== "object") {
    return errorResponse(400, "INVALID_REQUEST", "Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // ------------------------------------------------------------------
  // Input validation
  // ------------------------------------------------------------------
  const fieldErrors: string[] = [];

  if (typeof raw.hkhs_code !== "string") {
    fieldErrors.push("hkhs_code must be a string");
  }
  if (typeof raw.total_value_hkd !== "number") {
    fieldErrors.push("total_value_hkd must be a number");
  }
  if (typeof raw.departure_date !== "string") {
    fieldErrors.push("departure_date must be a string");
  }

  if (fieldErrors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing or invalid required fields",
        code: "INVALID_REQUEST",
        details: fieldErrors,
      },
      { status: 400 },
    );
  }

  const hkhsCode = raw.hkhs_code as string;
  const totalValueHKD = raw.total_value_hkd as number;
  const departureDate = raw.departure_date as string;

  // ------------------------------------------------------------------
  // Run compliance checks
  // ------------------------------------------------------------------
  const complianceErrors: string[] = [];

  // 1. HKHS Code
  const hsResult = validateHKHSCode(hkhsCode);
  if (!hsResult.valid) {
    complianceErrors.push(`HS code: ${hsResult.error}`);
  }

  // 2. Ad Valorem Tax
  let taxResult = null;
  if (totalValueHKD < 0) {
    complianceErrors.push("total_value_hkd must be non-negative");
  } else {
    taxResult = calculateAdValorem(totalValueHKD);
  }

  // 3. Deadline Status
  let deadlineResult = null;
  try {
    deadlineResult = checkDeadlineStatus(departureDate);
    if (deadlineResult.status === "CRITICAL") {
      complianceErrors.push(
        `Filing deadline breached: ${deadlineResult.days_elapsed} days elapsed ` +
          `(limit is 14 days). Penalty window active.`,
      );
    } else if (deadlineResult.status === "WARNING") {
      // WARNING is not a hard failure — include it in the response but
      // do not block the declaration.  Surface as an advisory message.
    }
  } catch (err) {
    const msg = err instanceof TypeError ? err.message : "Invalid departure_date";
    complianceErrors.push(`departure_date: ${msg}`);
  }

  // ------------------------------------------------------------------
  // Response
  // ------------------------------------------------------------------
  const isCompliant = complianceErrors.length === 0;
  const status = isCompliant ? 200 : 422;

  return NextResponse.json(
    {
      compliant: isCompliant,
      hkhs: hsResult,
      tax: taxResult,
      deadline: deadlineResult,
      ...(complianceErrors.length > 0 && { errors: complianceErrors }),
    },
    { status },
  );
}

function errorResponse(
  status: number,
  code: string,
  msg: string,
): NextResponse {
  return NextResponse.json({ success: false, error: msg, code }, { status });
}
