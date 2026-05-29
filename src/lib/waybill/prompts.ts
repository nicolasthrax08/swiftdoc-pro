/**
 * Prompt templates for waybill extraction and HS-code resolution.
 *
 * Two-stage pipeline:
 *   1. extractionPrompt  — extracts structured fields from a mixed
 *      Cantonese/English waybill (text or image).
 *   2. hsCodePrompt      — maps a product description to an 8-digit
 *      HKHS code, grounded by the seed dictionary.
 *   3. fallbackExtractionPrompt — used when confidence is low (< 0.6)
 *      for a second, more permissive attempt.
 */

import { buildSeedPromptBlock } from "./hkhs-seed";

// ---------------------------------------------------------------------------
// System instruction (shared)
// ---------------------------------------------------------------------------

export const WAYBILL_SYSTEM_INSTRUCTION = `
You are an expert in Hong Kong trade compliance and customs documentation.
You specialise in reading mixed Traditional Chinese (Cantonese) and English
shipping waybills used in HKSAR cross-border logistics.

Cantonese-to-English glossary (waybill extraction):
When extracting or translating goods, consignee, dates, and values from the
waybill, apply these mappings literally so downstream HS classification uses
consistent English product wording (examples below; extend by analogy for
similar compounds).

The same term pairs are applied programmatically to the product_description
field before HKHS seed lookup / HS-code resolution (see applyCantoneseWaybillGlossary
in src/lib/gemini/client.ts) — keep both lists aligned.

Key bilingual term mappings you must apply:
  手袋       → Handbag
  電子產品   → Electronics
  衣物       → Clothing
  海味       → Dried seafood
  珠寶       → Jewellery
  化妝品     → Cosmetics
  手提電腦   → Laptop
  智能手機   → Smartphone
  玩具       → Toys
  文件       → Documents
  收貨人     → Consignee
  出發日期   → Departure date
  貨物總值   → Total value
  貨品描述   → Product description
  品名       → Product name
  發票金額   → Invoice amount
  港幣       → HKD
  貨品編號   → HS code / commodity code

Always respond in valid JSON. Do not include markdown fences, prose, or
explanatory text — only the raw JSON object.
`.trim();

// ---------------------------------------------------------------------------
// 1. Primary extraction prompt
// ---------------------------------------------------------------------------

export function buildExtractionPrompt(waybillText?: string): string {
  const inputSection = waybillText
    ? `\n\nWaybill content:\n"""\n${waybillText}\n"""`
    : "\n\n[The waybill document has been provided as an image or PDF attachment above.]";

  return `
Extract the following fields from the waybill document.
Return ONLY a JSON object matching this exact schema — no extra keys.

{
  "consignee": "<company or person name receiving the shipment, string>",
  "departure_date": "<ISO 8601 date, e.g. 2025-06-15>",
  "total_value_hkd": <numeric value in HKD, no currency symbol>,
  "product_description": "<English description of the goods, translated from Chinese if needed>",
  "confidence_score": <float 0.0–1.0 reflecting extraction certainty>
}

Rules:
- If a field cannot be determined, set it to null.
- Translate all Chinese field values to English.
- For dates in formats like DD/MM/YYYY or YYYY年MM月DD日, convert to ISO 8601.
- For monetary amounts, extract the numeric value only (strip 港幣, HK$, $).
- confidence_score should reflect how complete and unambiguous the extraction is:
    1.0 = all fields found and unambiguous
    0.7–0.9 = most fields found, minor ambiguity
    0.4–0.6 = partial extraction or significant ambiguity
    < 0.4 = very little usable data found
${inputSection}
`.trim();
}

// ---------------------------------------------------------------------------
// 2. Fallback extraction prompt (lower confidence threshold, more permissive)
// ---------------------------------------------------------------------------

export function buildFallbackExtractionPrompt(
  previousResult: string,
  waybillText?: string,
): string {
  const inputSection = waybillText
    ? `\n\nOriginal waybill content:\n"""\n${waybillText}\n"""`
    : "\n\n[The waybill document was provided as an image or PDF in the previous turn.]";

  return `
The previous extraction attempt yielded low confidence. Please re-examine the
waybill more carefully, applying these additional heuristics:

Previous extraction result: ${previousResult}

Try harder to:
1. Find the consignee name — look for 收貨人, 收件人, "To:", "Consignee", company stamps
2. Find the date — look for 日期, ship date, booking date, ETD (Estimated Time of Departure)
3. Find the value — look for total, subtotal, invoice value, declared value, 申報價值
4. Find the product — look for 品名, 貨品, 貨物描述, "Description of Goods"

Return the same JSON schema with updated values and a revised confidence_score.
If you truly cannot extract a field, set it to null.
${inputSection}
`.trim();
}

// ---------------------------------------------------------------------------
// 3. HS code resolution prompt
// ---------------------------------------------------------------------------

export function buildHsCodePrompt(productDescription: string): string {
  const seedBlock = buildSeedPromptBlock();

  return `
You are a Hong Kong Customs & Excise Department classification expert.
Map the following product description to the most appropriate 8-digit
HKHS (Hong Kong Harmonized System) commodity code.

The description has already been normalised from common Cantonese waybill
terms to English where applicable (e.g. 手袋 → Handbag).

${seedBlock}

Product description: "${productDescription}"

Return ONLY a JSON object with this exact schema:
{
  "hkhs_code": "<8 digits, e.g. 42022190>",
  "matched_description": "<closest matching category from the reference list>",
  "confidence": <float 0.0–1.0>
}

Rules:
- The hkhs_code MUST be exactly 8 digits. If uncertain, pick the closest match.
- Do not include hyphens, spaces, or any formatting in hkhs_code.
- If the description matches multiple categories, pick the most specific one.
- If confidence is below 0.3, return hkhs_code as null.
`.trim();
}
