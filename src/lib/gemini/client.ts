/**
 * Gemini 1.5 Pro API client
 *
 * Thin wrapper around the Google Generative AI REST API.
 * Supports:
 *   - Text-only requests
 *   - Inline file parts (base64 image / PDF) for multimodal waybill processing
 *
 * Environment variable required: GEMINI_API_KEY
 * If absent, isgGeminiConfigured() returns false and all calls throw a
 * descriptive error so the route can return a 503 before hitting the API.
 */

export const GEMINI_MODEL = "gemini-1.5-pro";
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

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

// ---------------------------------------------------------------------------
// Types
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

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export interface GeminiRequest {
  parts: GeminiPart[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: string;
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
// Core call
// ---------------------------------------------------------------------------

export async function callGemini(req: GeminiRequest): Promise<GeminiResponse> {
  const apiKey = getApiKey();
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: req.parts,
      },
    ],
    generationConfig: req.generationConfig ?? {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  };

  if (req.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: req.systemInstruction }],
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(no body)");
    throw new Error(
      `Gemini API error ${response.status}: ${errorText}`,
    );
  }

  return (await response.json()) as GeminiResponse;
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
