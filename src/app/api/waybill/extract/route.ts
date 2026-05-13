/**
 * POST /api/waybill/extract
 *
 * Accepts a shipping waybill (mixed Cantonese/English) and returns structured
 * TDEC-ready data extracted by Gemini 1.5 Pro.
 *
 * Request formats (mutually exclusive):
 *   A) multipart/form-data
 *      - field "file": the waybill document (image/jpeg, image/png,
 *        image/webp, application/pdf)
 *      - field "filing_id" (optional): UUID linking to a filing_jobs row
 *
 *   B) application/json
 *      { "text": "<raw waybill text>", "filing_id"?: "<uuid>" }
 *
 * Response 200:
 *   {
 *     "success": true,
 *     "extraction_id": "<uuid>",
 *     "consignee": "<string|null>",
 *     "departure_date": "<ISO 8601|null>",
 *     "total_value_hkd": <number|null>,
 *     "hkhs_code": "<8-digit string|null>",
 *     "confidence_score": <number|null>,
 *     "manual_review_recommended": <boolean>,
 *     "raw_extraction": { ... }
 *   }
 *
 * Response 4xx/5xx:
 *   { "success": false, "error": "<message>", "code": "<ERROR_CODE>" }
 */

import { type NextRequest, NextResponse } from "next/server";
import { isGeminiConfigured } from "@/lib/gemini/client";
import { extractWaybill } from "@/lib/waybill/extract";

export const runtime = "nodejs";
// File uploads + two Gemini calls can take ~30s on cold paths.
export const maxDuration = 60;

// Supported MIME types for file uploads
const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

// Max file size: 10 MB (Gemini inline data limit is 20 MB base64)
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // ----------------------------------------------------------------
  // Guard: GEMINI_API_KEY
  // ----------------------------------------------------------------
  if (!isGeminiConfigured()) {
    return errorResponse(
      503,
      "GEMINI_NOT_CONFIGURED",
      "GEMINI_API_KEY is not set. Configure it in Vercel environment variables.",
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  // ----------------------------------------------------------------
  // Parse input
  // ----------------------------------------------------------------
  let text: string | undefined;
  let fileData: string | undefined;
  let fileMimeType: string | undefined;
  let filingId: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    // File upload path
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return errorResponse(400, "INVALID_REQUEST", "Failed to parse form data");
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return errorResponse(
        400,
        "MISSING_FILE",
        'Form field "file" is required for multipart requests',
      );
    }

    // Validate MIME type
    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      return errorResponse(
        415,
        "UNSUPPORTED_FILE_TYPE",
        `Unsupported file type "${file.type}". Supported: ${[...SUPPORTED_MIME_TYPES].join(", ")}`,
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse(
        413,
        "FILE_TOO_LARGE",
        `File exceeds maximum size of ${MAX_FILE_BYTES / 1024 / 1024} MB`,
      );
    }

    const bytes = await file.arrayBuffer();
    fileData = Buffer.from(bytes).toString("base64");
    fileMimeType = file.type;

    const rawFilingId = formData.get("filing_id");
    if (rawFilingId && typeof rawFilingId === "string") {
      filingId = rawFilingId;
    }
  } else if (contentType.includes("application/json")) {
    // JSON text path
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "INVALID_REQUEST", "Request body must be JSON");
    }

    if (!body || typeof body !== "object") {
      return errorResponse(400, "INVALID_REQUEST", "Request body must be a JSON object");
    }

    const b = body as Record<string, unknown>;

    if (typeof b.text !== "string" || !b.text.trim()) {
      return errorResponse(
        400,
        "MISSING_TEXT",
        'JSON body requires field "text" (non-empty string)',
      );
    }

    text = b.text.trim();

    if (typeof b.filing_id === "string" && b.filing_id.trim()) {
      filingId = b.filing_id.trim();
    }
  } else {
    return errorResponse(
      415,
      "UNSUPPORTED_CONTENT_TYPE",
      'Content-Type must be "multipart/form-data" or "application/json"',
    );
  }

  // ----------------------------------------------------------------
  // Run extraction
  // ----------------------------------------------------------------
  try {
    const result = await extractWaybill({ text, fileData, fileMimeType, filingId });

    return NextResponse.json(
      {
        success: true,
        extraction_id: result.extractionId,
        consignee: result.consignee,
        departure_date: result.departure_date,
        total_value_hkd: result.total_value_hkd,
        hkhs_code: result.hkhs_code,
        confidence_score: result.confidence_score,
        manual_review_recommended: result.manual_review_recommended,
        raw_extraction: result.raw_extraction,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[api/waybill/extract] Extraction error:", err);

    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";

    // Surface Gemini API errors with a distinct code
    if (message.includes("Gemini API error")) {
      return errorResponse(502, "GEMINI_API_ERROR", message);
    }

    // Supabase persistence errors
    if (message.includes("persist waybill extraction")) {
      return errorResponse(500, "PERSISTENCE_ERROR", message);
    }

    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function errorResponse(
  status: number,
  code: string,
  msg: string,
): NextResponse {
  return NextResponse.json({ success: false, error: msg, code }, { status });
}
