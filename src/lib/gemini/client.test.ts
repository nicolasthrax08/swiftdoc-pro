import { describe, expect, test } from "bun:test";

import {
  applyCantoneseWaybillGlossary,
  extractWaybillCanonicalFromCantoneseText,
  GEMINI_MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
  isGeminiConfigured,
  shouldRecommendManualReview,
} from "./client";

describe("applyCantoneseWaybillGlossary", () => {
  test("maps 手袋 to Handbag", () => {
    expect(applyCantoneseWaybillGlossary("手袋")).toBe("Handbag");
  });

  test("maps longer phrase 智能手機 before shorter overlaps", () => {
    expect(applyCantoneseWaybillGlossary("智能手機")).toBe("Smartphone");
  });

  test("replaces within a longer description", () => {
    expect(applyCantoneseWaybillGlossary("Declared goods: 手袋 x2")).toBe(
      "Declared goods: Handbag x2",
    );
  });
});

describe("shouldRecommendManualReview", () => {
  test("flags when hkhs code is missing", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: 0.95,
        hkhsConfidence: 0.9,
        hkhsCode: null,
      }),
    ).toBe(true);
  });

  test("flags when extraction confidence is below threshold", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: 0.5,
        hkhsConfidence: 0.9,
        hkhsCode: "42022190",
      }),
    ).toBe(true);
  });

  test("flags when extraction confidence is null", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: null,
        hkhsConfidence: 1,
        hkhsCode: "42022190",
      }),
    ).toBe(true);
  });

  test("flags when HS confidence is below threshold", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: 0.9,
        hkhsConfidence: 0.4,
        hkhsCode: "42022190",
      }),
    ).toBe(true);
  });

  test("does not flag when confidences are at or above threshold", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: GEMINI_MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
        hkhsConfidence: GEMINI_MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
        hkhsCode: "42022190",
      }),
    ).toBe(false);
  });

  test("does not flag when HS confidence is unknown (null) but code exists", () => {
    expect(
      shouldRecommendManualReview({
        extractionConfidence: 0.9,
        hkhsConfidence: null,
        hkhsCode: "42022190",
      }),
    ).toBe(false);
  });
});

/** Raw Cantonese / Traditional Chinese waybill-style lines for Gemini integration. */
const CANTONESE_WAYBILL_FIXTURE = `
收貨人：陳大文有限公司
出發日期：2024年3月15日
貨品編號：42022100
貨物總值：港幣 12,500
貨品描述：真皮手袋
`.trim();

const runGeminiIntegration = isGeminiConfigured();

(runGeminiIntegration ? describe : describe.skip)(
  "extractWaybillCanonicalFromCantoneseText (Gemini integration)",
  () => {
    test({ timeout: 120_000 }, "structured JSON from Cantonese waybill", async () => {
      const { parsed, response } =
        await extractWaybillCanonicalFromCantoneseText(
          CANTONESE_WAYBILL_FIXTURE,
        );

      expect(response.candidates.length).toBeGreaterThan(0);
      expect(parsed.consignee).toBeTruthy();
      expect(parsed.consignee).toMatch(/陳|Chan|有限公司|Limited/i);
      expect(parsed.departure_date).toBe("2024-03-15");
      expect(parsed.hkhs_code?.replace(/\D/g, "")).toMatch(/^42022100$/);
      expect(parsed.total_value_hkd).not.toBeNull();
      const value = Number(parsed.total_value_hkd);
      expect(value).toBeGreaterThanOrEqual(12499);
      expect(value).toBeLessThanOrEqual(12501);
    });
  },
);
