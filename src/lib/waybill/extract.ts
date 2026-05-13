/**
 * Waybill extraction service
 *
 * Pipeline:
 *   1. Primary Gemini call — extract consignee, date, value, product description
 *   2. If confidence < FALLBACK_THRESHOLD, run fallback extraction prompt
 *   3. Second Gemini call — map product description to 8-digit HKHS code
 *   4. Validate and normalise the result
 *   5. Persist to Supabase `waybill_extractions`
 */

import {
  callGemini,
  extractResponseText,
  type GeminiPart,
  type GeminiResponse,
} from "@/lib/gemini/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildExtractionPrompt,
  buildFallbackExtractionPrompt,
  buildHsCodePrompt,
  WAYBILL_SYSTEM_INSTRUCTION,
} from "./prompts";
import { lookupHkhsCode } from "./hkhs-seed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Below this confidence score the fallback prompt is triggered. */
const FALLBACK_THRESHOLD = 0.6;

/** Regex for validating 8-digit HKHS code. */
const HKHS_CODE_REGEX = /^\d{8}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaybillExtractionInput {
  /** Raw text content of the waybill (mutually exclusive with fileData). */
  text?: string;
  /** Base64-encoded file bytes (image or PDF). */
  fileData?: string;
  /** MIME type of fileData, e.g. "image/jpeg" or "application/pdf". */
  fileMimeType?: string;
  /** Optional filing job ID to link the record to. */
  filingId?: string;
}

export interface WaybillExtractionResult {
  /** Unique ID of the saved waybill_extractions row. */
  extractionId: string;
  /** The consignee name. */
  consignee: string | null;
  /** ISO 8601 date string. */
  departure_date: string | null;
  /** Total value in HKD. */
  total_value_hkd: number | null;
  /** 8-digit HKHS commodity code. */
  hkhs_code: string | null;
  /** AI confidence score 0.0–1.0. */
  confidence_score: number | null;
  /** Full raw Gemini responses for auditability. */
  raw_extraction: {
    primary: GeminiResponse;
    fallback?: GeminiResponse;
    hs_code: GeminiResponse | null;
    primary_parsed: unknown;
    fallback_parsed?: unknown;
    hs_code_parsed?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences and trim whitespace from a Gemini text response.
 * Gemini sometimes wraps JSON in ```json … ``` despite being instructed not to.
 */
function sanitiseJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeParse<T>(text: string): T | null {
  try {
    return JSON.parse(sanitiseJson(text)) as T;
  } catch {
    return null;
  }
}

interface ExtractionRaw {
  consignee?: string | null;
  departure_date?: string | null;
  total_value_hkd?: number | string | null;
  product_description?: string | null;
  confidence_score?: number | null;
}

interface HsCodeRaw {
  hkhs_code?: string | null;
  matched_description?: string | null;
  confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Stage 1: field extraction
// ---------------------------------------------------------------------------

async function runExtractionStage(
  input: WaybillExtractionInput,
): Promise<{
  primaryResponse: GeminiResponse;
  fallbackResponse?: GeminiResponse;
  parsed: ExtractionRaw;
  usedFallback: boolean;
}> {
  // Build parts array — either text or inline multimodal data
  const parts: GeminiPart[] = [];

  if (input.fileData && input.fileMimeType) {
    parts.push({
      inlineData: {
        mimeType: input.fileMimeType,
        data: input.fileData,
      },
    });
  }

  // Always add the extraction instruction as a text part
  parts.push({ text: buildExtractionPrompt(input.text) });

  const primaryResponse = await callGemini({
    parts,
    systemInstruction: WAYBILL_SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.05,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  });

  const primaryText = extractResponseText(primaryResponse);
  let parsed = safeParse<ExtractionRaw>(primaryText);

  // If JSON parse failed, treat as empty object with zero confidence
  if (!parsed) {
    parsed = { confidence_score: 0 };
  }

  const confidence = Number(parsed.confidence_score ?? 0);

  // Below fallback threshold — try once more with a more permissive prompt
  if (confidence < FALLBACK_THRESHOLD) {
    const fallbackParts: GeminiPart[] = [];

    if (input.fileData && input.fileMimeType) {
      fallbackParts.push({
        inlineData: {
          mimeType: input.fileMimeType,
          data: input.fileData,
        },
      });
    }

    fallbackParts.push({
      text: buildFallbackExtractionPrompt(primaryText, input.text),
    });

    const fallbackResponse = await callGemini({
      parts: fallbackParts,
      systemInstruction: WAYBILL_SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.15,
        topP: 0.98,
        maxOutputTokens: 1024,
      },
    });

    const fallbackText = extractResponseText(fallbackResponse);
    const fallbackParsed = safeParse<ExtractionRaw>(fallbackText);

    if (
      fallbackParsed &&
      Number(fallbackParsed.confidence_score ?? 0) >= confidence
    ) {
      return {
        primaryResponse,
        fallbackResponse,
        parsed: fallbackParsed,
        usedFallback: true,
      };
    }

    return {
      primaryResponse,
      fallbackResponse,
      parsed,
      usedFallback: false,
    };
  }

  return { primaryResponse, parsed, usedFallback: false };
}

// ---------------------------------------------------------------------------
// Stage 2: HS code resolution
// ---------------------------------------------------------------------------

async function resolveHsCode(
  productDescription: string | null | undefined,
): Promise<{
  code: string | null;
  response: GeminiResponse | null;
  parsed: HsCodeRaw | null;
}> {
  if (!productDescription) {
    return { code: null, response: null, parsed: null };
  }

  // Fast-path: exact seed dictionary match
  const seedCode = lookupHkhsCode(productDescription);
  if (seedCode) {
    return {
      code: seedCode,
      response: null,
      parsed: { hkhs_code: seedCode, confidence: 1.0 },
    };
  }

  const response = await callGemini({
    parts: [{ text: buildHsCodePrompt(productDescription) }],
    systemInstruction: WAYBILL_SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 256,
    },
  });

  const text = extractResponseText(response);
  const parsed = safeParse<HsCodeRaw>(text);

  if (!parsed?.hkhs_code) {
    return { code: null, response, parsed };
  }

  // Validate 8-digit format
  const code = String(parsed.hkhs_code).trim();
  if (!HKHS_CODE_REGEX.test(code)) {
    return { code: null, response, parsed };
  }

  return { code, response, parsed };
}

// ---------------------------------------------------------------------------
// Normalise extracted fields
// ---------------------------------------------------------------------------

function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Already ISO 8601 date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Try parsing as a JS Date
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normaliseValue(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function extractWaybill(
  input: WaybillExtractionInput,
): Promise<WaybillExtractionResult> {
  if (!input.text && !input.fileData) {
    throw new Error("Either text or fileData must be provided");
  }

  // Stage 1 — field extraction
  const { primaryResponse, fallbackResponse, parsed, usedFallback } =
    await runExtractionStage(input);

  // Stage 2 — HS code resolution
  const {
    code: hkhsCode,
    response: hsCodeResponse,
    parsed: hsCodeParsed,
  } = await resolveHsCode(parsed.product_description);

  // Normalise fields
  const consignee = parsed.consignee?.trim() || null;
  const departureDate = normaliseDate(parsed.departure_date);
  const totalValueHkd = normaliseValue(parsed.total_value_hkd);
  const confidenceScore =
    parsed.confidence_score != null
      ? Math.max(0, Math.min(1, Number(parsed.confidence_score)))
      : null;

  // Build raw_extraction blob for auditability
  const rawExtraction = {
    primary: primaryResponse,
    ...(fallbackResponse ? { fallback: fallbackResponse } : {}),
    hs_code: hsCodeResponse,
    primary_parsed: safeParse(extractResponseText(primaryResponse)),
    ...(usedFallback && fallbackResponse
      ? {
          fallback_parsed: safeParse(
            extractResponseText(fallbackResponse),
          ),
        }
      : {}),
    ...(hsCodeParsed ? { hs_code_parsed: hsCodeParsed } : {}),
  };

  // Persist to Supabase
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("waybill_extractions")
    .insert({
      filing_id: input.filingId ?? null,
      consignee,
      departure_date: departureDate,
      total_value_hkd: totalValueHkd,
      hkhs_code: hkhsCode,
      confidence_score: confidenceScore,
      raw_extraction: rawExtraction,
    })
    .select("id")
    .single();

  if (error || !row) {
    throw new Error(
      `Failed to persist waybill extraction: ${error?.message ?? "no row returned"}`,
    );
  }

  return {
    extractionId: row.id as string,
    consignee,
    departure_date: departureDate,
    total_value_hkd: totalValueHkd,
    hkhs_code: hkhsCode,
    confidence_score: confidenceScore,
    raw_extraction: rawExtraction,
  };
}
