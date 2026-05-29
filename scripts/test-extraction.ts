/**
 * Week 3 pilot: read mock SF waybill HTML, extract fields with Gemini
 * (structured JSON + system glossary), apply HK ad-valorem floor logic,
 * and 14-day watchdog vs departure date.
 *
 * Run from repo root:
 *   GEMINI_API_KEY=... bun scripts/test-extraction.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResponseSchema, SafetySetting } from "@google/generative-ai";
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
} from "@google/generative-ai";

import { WAYBILL_SYSTEM_INSTRUCTION } from "../src/lib/waybill/prompts";

const GEMINI_MODEL = "gemini-1.5-pro";

const SAFETY_SETTINGS = [
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
] as const satisfies readonly SafetySetting[];

/** HK government style ad valorem: 0.3% of declared value, minimum HK$0.20. */
function computeAdValoremTaxHkd(declaredValueHkd: number): number {
  return Math.max(0.2, declaredValueHkd * 0.003);
}

/** Whole calendar days from `from` (inclusive start of day) to `to` (exclusive of time-of-day noise). */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

const WAYBILL_HTML_EXTRACTION_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  description:
    "Structured fields parsed from an HTML shipping waybill (HK). Use the system glossary: 手袋 must appear as Handbag in product_description.",
  properties: {
    consignee: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Primary consignee / shipper name (English preferred).",
    },
    departure_date: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Shipment departure date as ISO 8601 date YYYY-MM-DD.",
    },
    total_value_hkd: {
      type: SchemaType.NUMBER,
      nullable: true,
      description: "Total declared value in Hong Kong dollars (numeric only).",
    },
    hkhs_code: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Eight-digit HK Harmonized System code (digits only, no dots).",
    },
    product_description: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "English goods description; apply glossary (e.g. 手袋 → Handbag).",
    },
  },
  required: [
    "consignee",
    "departure_date",
    "total_value_hkd",
    "hkhs_code",
    "product_description",
  ],
};

interface ExtractedWaybill {
  consignee: string | null;
  departure_date: string | null;
  total_value_hkd: number | null;
  hkhs_code: string | null;
  product_description: string | null;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function extractFromHtml(html: string): Promise<ExtractedWaybill> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: WAYBILL_SYSTEM_INSTRUCTION,
  });

  const userPrompt = [
    "Read the following HTML waybill. Extract the commercial fields.",
    "Interpret dates on the document and normalise departure_date to YYYY-MM-DD.",
    "If the HS code appears with a dot (e.g. 4202.21), normalise hkhs_code to an 8-digit string without punctuation (pad with trailing zeros only if the source clearly implies an 8-digit HKHS commodity code).",
    "product_description must follow the Cantonese glossary in the system instruction (手袋 → Handbag).",
    "",
    "--- HTML ---",
    html,
  ].join("\n");

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.05,
      topP: 0.95,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: WAYBILL_HTML_EXTRACTION_SCHEMA,
    },
    safetySettings: [...SAFETY_SETTINGS],
  });

  const raw = result.response.text();
  return JSON.parse(raw) as ExtractedWaybill;
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Set GEMINI_API_KEY and run from the repository root.");
    process.exit(1);
  }

  const htmlPath = path.join(repoRoot(), "storage/samples/mock_waybill.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const extracted = await extractFromHtml(html);

  const valueHkd = Number(extracted.total_value_hkd ?? 0);
  const adValoremTaxHkd = computeAdValoremTaxHkd(
    Number.isFinite(valueHkd) ? valueHkd : 0,
  );

  const departureIso = extracted.departure_date?.trim() ?? null;
  const referenceDate = departureIso
    ? new Date(`${departureIso}T00:00:00+08:00`)
    : new Date("2026-04-28T00:00:00+08:00");

  const today = new Date();
  const daysElapsed = calendarDaysBetween(referenceDate, today);
  const watchdogStatus = daysElapsed > 14 ? "CRITICAL" : "CLEAR";

  const asOf = today.toISOString().slice(0, 10);

  const output = {
    extraction: extracted,
    translation_check: {
      glossary_handbag_expected: "Handbag",
      product_description: extracted.product_description,
      handbag_glossary_applied:
        (extracted.product_description ?? "")
          .toLowerCase()
          .includes("handbag"),
    },
    tax: {
      declared_value_hkd: valueHkd,
      /** Math.max(0.20, value * 0.003) per HK-style minimum floor. */
      ad_valorem_tax_hkd: adValoremTaxHkd,
    },
    watchdog: {
      reference_date: departureIso ?? "2026-04-28",
      as_of: asOf,
      days_elapsed: daysElapsed,
      threshold_days: 14,
      status: watchdogStatus,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
