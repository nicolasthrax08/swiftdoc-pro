/**
 * Unit tests for the SwiftDoc Compliance Engine (src/lib/compliance.ts).
 *
 * Run with: bun test
 */

import { describe, expect, it } from "bun:test";
import {
  calculateAdValorem,
  checkDeadlineStatus,
  validateHKHSCode,
} from "./compliance";

// ----------------------------------------------------------------
// 1. validateHKHSCode
// ----------------------------------------------------------------

describe("validateHKHSCode", () => {
  it("accepts a valid 8-digit code", () => {
    expect(validateHKHSCode("12345678")).toEqual({ valid: true });
  });

  it("accepts all-zeros code", () => {
    expect(validateHKHSCode("00000000")).toEqual({ valid: true });
  });

  it("rejects empty string", () => {
    const result = validateHKHSCode("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects a 7-digit code", () => {
    const result = validateHKHSCode("1234567");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/8 numeric digits/);
  });

  it("rejects a 9-digit code", () => {
    const result = validateHKHSCode("123456789");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/8 numeric digits/);
  });

  it("rejects a code with letters", () => {
    const result = validateHKHSCode("1234567A");
    expect(result.valid).toBe(false);
  });

  it("rejects a code with a dash", () => {
    const result = validateHKHSCode("1234-678");
    expect(result.valid).toBe(false);
  });

  it("rejects a code with a leading space", () => {
    const result = validateHKHSCode(" 12345678");
    expect(result.valid).toBe(false);
  });

  it("rejects a code with a decimal point", () => {
    const result = validateHKHSCode("1234.678");
    expect(result.valid).toBe(false);
  });
});

// ----------------------------------------------------------------
// 2. calculateAdValorem
// ----------------------------------------------------------------

describe("calculateAdValorem", () => {
  it("applies 0.3% rate on a standard value", () => {
    // HK$10,000 × 0.003 = HK$30.00 — well above the floor
    const result = calculateAdValorem(10_000);
    expect(result.tax).toBe(30.0);
    expect(result.rate).toBe(0.003);
    expect(result.floor_applied).toBe(false);
  });

  it("returns HK$0.20 when computed tax is below the floor", () => {
    // HK$50 × 0.003 = HK$0.15 — below floor
    const result = calculateAdValorem(50);
    expect(result.tax).toBe(0.20);
    expect(result.floor_applied).toBe(true);
  });

  it("returns exactly HK$0.20 at the boundary (HK$66.67 = 0.2001… → rounds above floor)", () => {
    // HK$66.67 × 0.003 = 0.20001 → rounds to 0.20, floor NOT applied
    const result = calculateAdValorem(66.67);
    expect(result.tax).toBe(0.20);
    expect(result.floor_applied).toBe(false);
  });

  it("floor_applied is true when raw tax equals exactly HK$0.20 boundary below", () => {
    // Any value where totalValueHKD * 0.003 < 0.20, e.g. HK$66.66 → 0.19998
    const result = calculateAdValorem(66.66);
    expect(result.tax).toBe(0.20);
    expect(result.floor_applied).toBe(true);
  });

  it("applies the floor for zero value", () => {
    const result = calculateAdValorem(0);
    expect(result.tax).toBe(0.20);
    expect(result.floor_applied).toBe(true);
  });

  it("rounds result to 2 decimal places", () => {
    // HK$100.005 × 0.003 = 0.300015 → rounds to 0.30
    const result = calculateAdValorem(100.005);
    const decimals = result.tax.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it("throws RangeError for negative values", () => {
    expect(() => calculateAdValorem(-1)).toThrow(RangeError);
  });

  it("rate is always 0.003", () => {
    expect(calculateAdValorem(0).rate).toBe(0.003);
    expect(calculateAdValorem(1_000_000).rate).toBe(0.003);
  });

  it("handles large values correctly", () => {
    // HK$1,000,000 × 0.003 = HK$3,000.00
    const result = calculateAdValorem(1_000_000);
    expect(result.tax).toBe(3000.0);
    expect(result.floor_applied).toBe(false);
  });
});

// ----------------------------------------------------------------
// 3. checkDeadlineStatus
// ----------------------------------------------------------------

/**
 * Return a date string that is exactly `n` whole days before now (UTC).
 * We set time to 00:00:00Z so the elapsed-day calculation is deterministic.
 */
function daysAgoISO(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

describe("checkDeadlineStatus", () => {
  it("returns OK when departure was 5 days ago", () => {
    const result = checkDeadlineStatus(daysAgoISO(5));
    expect(result.status).toBe("OK");
    expect(result.days_elapsed).toBe(5);
    expect(result.days_remaining).toBe(9);
  });

  it("returns OK when departure was yesterday (1 day ago)", () => {
    const result = checkDeadlineStatus(daysAgoISO(1));
    expect(result.status).toBe("OK");
  });

  it("returns OK when departure is today (0 days ago)", () => {
    const result = checkDeadlineStatus(daysAgoISO(0));
    expect(result.status).toBe("OK");
  });

  it("returns WARNING when departure was 11 days ago (lower warning boundary)", () => {
    const result = checkDeadlineStatus(daysAgoISO(11));
    expect(result.status).toBe("WARNING");
    expect(result.days_elapsed).toBe(11);
    expect(result.days_remaining).toBe(3);
  });

  it("returns WARNING when departure was 13 days ago", () => {
    const result = checkDeadlineStatus(daysAgoISO(13));
    expect(result.status).toBe("WARNING");
  });

  it("returns WARNING when departure was exactly 14 days ago (deadline day)", () => {
    const result = checkDeadlineStatus(daysAgoISO(14));
    expect(result.status).toBe("WARNING");
    expect(result.days_elapsed).toBe(14);
    expect(result.days_remaining).toBe(0);
  });

  it("returns CRITICAL when departure was 15 days ago (one day over)", () => {
    const result = checkDeadlineStatus(daysAgoISO(15));
    expect(result.status).toBe("CRITICAL");
    expect(result.days_elapsed).toBe(15);
    expect(result.days_remaining).toBe(-1);
  });

  it("returns CRITICAL when departure was 30 days ago", () => {
    const result = checkDeadlineStatus(daysAgoISO(30));
    expect(result.status).toBe("CRITICAL");
  });

  it("accepts full ISO 8601 datetime strings", () => {
    // 20 days ago as a full timestamp
    const ts = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkDeadlineStatus(ts);
    expect(result.status).toBe("CRITICAL");
  });

  it("handles future departure dates (days_elapsed is negative)", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = checkDeadlineStatus(future);
    expect(result.status).toBe("OK");
    expect(result.days_elapsed).toBeLessThan(0);
  });

  it("throws TypeError for an invalid date string", () => {
    expect(() => checkDeadlineStatus("not-a-date")).toThrow(TypeError);
    expect(() => checkDeadlineStatus("2026-13-01")).toThrow(TypeError);
  });
});
