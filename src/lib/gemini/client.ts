/**
 * Gemini 1.5 Pro API client
 *
 * Wrapper around `@google/generative-ai` that uses the SDK surface area in
 * depth:
 *   - {@link GoogleGenerativeAI#getGenerativeModel} with system instructions
 *   - {@link GenerativeModel#generateContent} with full {@link GenerationConfig}
 *     (including `responseMimeType: "application/json"` and
 *     {@link GenerationConfig#responseSchema} for constrained JSON)
 *   - Default {@link SafetySetting}s via {@link HarmCategory} /
 *     {@link HarmBlockThreshold}
 *   - {@link GenerativeModel#countTokens} for prompt sizing
 *   - Text + {@link Part} inline data for multimodal waybills
 *
 * By default, every request uses `WAYBILL_SYSTEM_INSTRUCTION` from
 * `src/lib/waybill/prompts.ts` so the model sees Cantonese→English glossary
 * rules during extraction.
 *
 * The waybill pipeline also calls {@link applyCantoneseWaybillGlossary} on the
 * extracted `product_description` **before** HKHS seed lookup / Gemini HS
 * resolution so Chinese trade terms (e.g. 手袋 → Handbag) are normalised
 * deterministically ahead of the 8-digit code step.
 *
 * Use {@link shouldRecommendManualReview} after extraction + HS resolution to
 * surface low-confidence rows for human review.
 *
 * Environment variable required: GEMINI_API_KEY
 * If absent, isGeminiConfigured() returns false and all calls throw a
 * descriptive error so the route can return a 503 before hitting the API.
 */

import type {
  GenerateContentResponse,
  GenerationConfig,
  Part,
  ResponseSchema,
  SafetySetting,
} from "@google/generative-ai";
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
} from "@google/generative-ai";

import { WAYBILL_SYSTEM_INSTRUCTION } from "@/lib/waybill/prompts";

export const GEMINI_MODEL = "gemini-1.5-pro";

// ---------------------------------------------------------------------------
// Cantonese → English glossary (keep in sync with prompts.ts WAYBILL_SYSTEM_INSTRUCTION)
// ---------------------------------------------------------------------------

/** Below this confidence (extraction or HS), recommend manual review. */
export const GEMINI_MANUAL_REVIEW_CONFIDENCE_THRESHOLD = 0.6;

const WAYBILL_CANTONESE_GLOSSARY_RAW: ReadonlyArray<readonly [string, string]> =
  [
    ["手袋", "Handbag"],
    ["電子產品", "Electronics"],
    ["衣物", "Clothing"],
    ["海味", "Dried seafood"],
    ["珠寶", "Jewellery"],
    ["化妝品", "Cosmetics"],
    ["手提電腦", "Laptop"],
    ["智能手機", "Smartphone"],
    ["玩具", "Toys"],
    ["文件", "Documents"],
    ["收貨人", "Consignee"],
    ["出發日期", "Departure date"],
    ["貨物總值", "Total value"],
    ["貨品描述", "Product description"],
    ["品名", "Product name"],
    ["發票金額", "Invoice amount"],
    ["港幣", "HKD"],
    ["貨品編號", "HS code / commodity code"],
  ];

const WAYBILL_CANTONESE_GLOSSARY_ORDERED = [...WAYBILL_CANTONESE_GLOSSARY_RAW].sort(
  (a, b) => b[0].length - a[0].length,
);

/**
 * Apply the Cantonese waybill glossary as literal substring replacements
 * (longest phrases first). Intended on `product_description` immediately before
 * HKHS seed lookup and HS-code Gemini calls.
 */
export function applyCantoneseWaybillGlossary(text: string): string {
  let out = text;
  for (const [from, to] of WAYBILL_CANTONESE_GLOSSARY_ORDERED) {
    if (from.length === 0) continue;
    out = out.split(from).join(to);
  }
  return out;
}

export interface ManualReviewInput {
  extractionConfidence: number | null;
  /** HS resolution confidence when the model ran; null for seed fast-path or unknown. */
  hkhsConfidence: number | null;
  hkhsCode: string | null;
}

/**
 * True when extraction or HS confidence is below the threshold, or when no
 * valid 8-digit HKHS code was produced.
 */
export function shouldRecommendManualReview(input: ManualReviewInput): boolean {
  if (!input.hkhsCode?.trim()) {
    return true;
  }
  const t = GEMINI_MANUAL_REVIEW_CONFIDENCE_THRESHOLD;
  if (
    input.extractionConfidence == null ||
    input.extractionConfidence < t
  ) {
    return true;
  }
  if (input.hkhsConfidence != null && input.hkhsConfidence < t) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to Vercel environment variables.",
    );
  }
  return key;
}

let googleGenAiSingleton: GoogleGenerativeAI | null = null;

function getGoogleGenerativeAI(): GoogleGenerativeAI {
  if (!googleGenAiSingleton) {
    googleGenAiSingleton = new GoogleGenerativeAI(getApiKey());
  }
  return googleGenAiSingleton;
}

/**
 * SDK-native safety profile: block medium-and-above harm likelihoods across
 * standard categories (appropriate for untrusted user document uploads).
 */
export const GEMINI_DEFAULT_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

/**
 * JSON schema for canonical waybill fields (Gemini structured output).
 * Used with `responseMimeType: "application/json"`.
 */
export const WAYBILL_CANONICAL_EXTRACTION_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  description:
    "Hong Kong waybill / declaration fields extracted from Cantonese, Traditional Chinese, or mixed text.",
  properties: {
    consignee: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Consignee / 收貨人 name (English preferred when translating).",
    },
    departure_date: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Shipment departure date as ISO 8601 calendar date YYYY-MM-DD.",
    },
    hkhs_code: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Eight-digit Hong Kong Harmonized System (HKHS) commodity code if present.",
    },
    total_value_hkd: {
      type: SchemaType.NUMBER,
      nullable: true,
      description: "Total declared value in Hong Kong dollars (numeric only).",
    },
  },
  required: [
    "consignee",
    "departure_date",
    "hkhs_code",
    "total_value_hkd",
  ],
};

export interface WaybillCanonicalExtractionJson {
  consignee: string | null;
  departure_date: string | null;
  hkhs_code: string | null;
  total_value_hkd: number | null;
}

// ---------------------------------------------------------------------------
// Types (stable JSON shape for audit logs / DB blobs)
// ---------------------------------------------------------------------------

export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string; // base64-encoded bytes
  };
}

export type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

export type GeminiGenerationConfig = GenerationConfig;

export interface GeminiRequest {
  parts: GeminiPart[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: string;
  /** Per-request overrides; defaults to {@link GEMINI_DEFAULT_SAFETY_SETTINGS}. */
  safetySettings?: SafetySetting[];
}

export interface GeminiCandidate {
  content: { parts: GeminiTextPart[]; role: string };
  finishReason: string;
  safetyRatings?: unknown[];
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ---------------------------------------------------------------------------
// SDK helpers
// ---------------------------------------------------------------------------

function toSdkParts(parts: GeminiPart[]): Part[] {
  return parts.map((p) => {
    if ("text" in p) {
      return { text: p.text };
    }
    return {
      inlineData: {
        mimeType: p.inlineData.mimeType,
        data: p.inlineData.data,
      },
    };
  });
}

function mapSdkResponse(sdk: GenerateContentResponse): GeminiResponse {
  const candidates: GeminiCandidate[] = (sdk.candidates ?? []).map((c) => {
    const rawParts = c.content?.parts ?? [];
    const textParts: GeminiTextPart[] = rawParts
      .filter(
        (part): part is { text: string } =>
          typeof (part as { text?: string }).text === "string",
      )
      .map((part) => ({ text: part.text }));

    return {
      content: {
        role: c.content?.role ?? "model",
        parts: textParts,
      },
      finishReason: String(c.finishReason ?? ""),
      safetyRatings: c.safetyRatings,
    };
  });

  const usage = sdk.usageMetadata;
  const usageMetadata =
    usage &&
    typeof usage.promptTokenCount === "number" &&
    typeof usage.candidatesTokenCount === "number" &&
    typeof usage.totalTokenCount === "number"
      ? {
          promptTokenCount: usage.promptTokenCount,
          candidatesTokenCount: usage.candidatesTokenCount,
          totalTokenCount: usage.totalTokenCount,
        }
      : undefined;

  return { candidates, usageMetadata };
}

// ---------------------------------------------------------------------------
// Core call
// ---------------------------------------------------------------------------

export async function callGemini(req: GeminiRequest): Promise<GeminiResponse> {
  const genAI = getGoogleGenerativeAI();
  const trimmed = req.systemInstruction?.trim();
  const systemInstruction =
    trimmed && trimmed.length > 0 ? trimmed : WAYBILL_SYSTEM_INSTRUCTION;

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  const generationConfig: GenerationConfig = {
    temperature: 0.1,
    topP: 0.95,
    maxOutputTokens: 2048,
    ...req.generationConfig,
  };

  const safetySettings =
    req.safetySettings ?? GEMINI_DEFAULT_SAFETY_SETTINGS;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: toSdkParts(req.parts) }],
    generationConfig,
    safetySettings,
  });

  const sdkResponse = result.response;
  return mapSdkResponse(sdkResponse);
}

/**
 * Count input tokens for a would-be {@link callGemini} request using the SDK's
 * {@link GenerativeModel#countTokens} (excludes max output; measures prompt only).
 */
export async function countGeminiPromptTokens(
  req: Pick<GeminiRequest, "parts" | "systemInstruction">,
): Promise<number> {
  const genAI = getGoogleGenerativeAI();
  const trimmed = req.systemInstruction?.trim();
  const systemInstruction =
    trimmed && trimmed.length > 0 ? trimmed : WAYBILL_SYSTEM_INSTRUCTION;

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  const { totalTokens } = await model.countTokens({
    generateContentRequest: {
      contents: [{ role: "user", parts: toSdkParts(req.parts) }],
    },
  });

  return totalTokens;
}

function buildCantoneseCanonicalExtractionUserPrompt(
  rawCantoneseText: string,
): string {
  return [
    "Extract the following Hong Kong waybill / customs declaration fields from the text below.",
    "The source may be Cantonese, Traditional Chinese, English, or mixed. Apply the system glossary for labels and goods.",
    "Populate every JSON key; use null when a value is unknown or absent.",
    "",
    "--- Source ---",
    rawCantoneseText.trim(),
  ].join("\n");
}

/**
 * One-shot extraction: raw Cantonese / mixed waybill text → strict JSON using
 * Gemini structured output (`responseSchema` + `application/json`).
 */
export async function extractWaybillCanonicalFromCantoneseText(
  rawCantoneseText: string,
): Promise<{ parsed: WaybillCanonicalExtractionJson; response: GeminiResponse }> {
  const response = await callGemini({
    parts: [
      { text: buildCantoneseCanonicalExtractionUserPrompt(rawCantoneseText) },
    ],
    generationConfig: {
      temperature: 0.05,
      topP: 0.95,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      responseSchema: WAYBILL_CANONICAL_EXTRACTION_RESPONSE_SCHEMA,
    },
  });

  const parsed = parseGeminiJsonResponse<WaybillCanonicalExtractionJson>(
    response,
  );
  return { parsed, response };
}

// ---------------------------------------------------------------------------
// Helper: extract the text content from a Gemini response
// ---------------------------------------------------------------------------

export function extractResponseText(res: GeminiResponse): string {
  const candidate = res.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates");
  }
  return candidate.content.parts.map((p) => p.text).join("").trim();
}

/**
 * Parse the first candidate's text as JSON (for `responseMimeType: "application/json"`).
 */
export function parseGeminiJsonResponse<T>(res: GeminiResponse): T {
  const text = extractResponseText(res);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Gemini JSON response could not be parsed: ${text.slice(0, 200)}`,
      { cause: e },
    );
  }
}
