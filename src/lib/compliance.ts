/**
 * SwiftDoc Compliance Engine
 *
 * Provides three pure utility functions for HKSAR trade compliance:
 *   1. validateHKHSCode  — strict 8-digit HS code validation
 *   2. calculateAdValorem — ad valorem tax with HK$0.20 floor
 *   3. checkDeadlineStatus — 14-day TDEC filing watchdog
 *
 * All functions are stateless and dependency-free so they can run in
 * both server and edge contexts, and are fully unit-testable.
 */

// ----------------------------------------------------------------
// 1. HKHS Code Validator
// ----------------------------------------------------------------

const HKHS_REGEX = /^\d{8}$/;

export interface HKHSValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an HKSAR Harmonized System code.
 *
 * A valid HKHS code is exactly 8 ASCII decimal digits (0–9).
 * No spaces, dashes, or other characters are permitted.
 *
 * @param code - The HS code string to validate.
 * @returns `{ valid: true }` or `{ valid: false, error: "<reason>" }`.
 */
export function validateHKHSCode(code: string): HKHSValidationResult {
  if (typeof code !== "string") {
    return { valid: false, error: "HS code must be a string" };
  }
  if (code.length === 0) {
    return { valid: false, error: "HS code must not be empty" };
  }
  if (!HKHS_REGEX.test(code)) {
    return {
      valid: false,
      error: "HS code must be exactly 8 numeric digits (e.g. 12345678)",
    };
  }
  return { valid: true };
}

// ----------------------------------------------------------------
// 2. Ad Valorem Tax Calculator
// ----------------------------------------------------------------

const AD_VALOREM_RATE = 0.003;   // 0.3 %
const AD_VALOREM_FLOOR = 0.20;   // HK$0.20 minimum

export interface AdValoremResult {
  tax: number;
  rate: number;
  floor_applied: boolean;
}

/**
 * Calculate the ad valorem tax for a TDEC declaration.
 *
 * Formula: tax = max(totalValueHKD × 0.003, 0.20)
 * The HK$0.20 minimum is mandatory with no exceptions.
 * Result is rounded to 2 decimal places.
 *
 * @param totalValueHKD - Total declared CIF value in Hong Kong Dollars.
 * @returns Tax amount, the effective rate, and whether the floor was applied.
 * @throws {RangeError} When `totalValueHKD` is negative.
 */
export function calculateAdValorem(totalValueHKD: number): AdValoremResult {
  if (totalValueHKD < 0) {
    throw new RangeError("totalValueHKD must be non-negative");
  }

  const rawTax = totalValueHKD * AD_VALOREM_RATE;
  const tax = round2(Math.max(AD_VALOREM_FLOOR, rawTax));
  const floor_applied = rawTax < AD_VALOREM_FLOOR;

  return {
    tax,
    rate: AD_VALOREM_RATE,
    floor_applied,
  };
}

/** Round a number to 2 decimal places using "round half away from zero". */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ----------------------------------------------------------------
// 3. 14-Day Watchdog
// ----------------------------------------------------------------

export type DeadlineStatus = "OK" | "WARNING" | "CRITICAL";

export interface DeadlineStatusResult {
  status: DeadlineStatus;
  days_remaining: number;
  days_elapsed: number;
}

/**
 * Check where a declaration's departure date falls within the 14-day
 * TDEC filing window.
 *
 * Thresholds (measured in whole calendar days elapsed since departure):
 *   - CRITICAL : > 14 days elapsed (penalty window breached)
 *   - WARNING  : 11–14 days elapsed (approaching deadline)
 *   - OK       : < 11 days elapsed
 *
 * `days_elapsed` and `days_remaining` are truncated integer values.
 * A negative `days_elapsed` means the departure date is in the future.
 *
 * @param departureDate - ISO 8601 date string (e.g. "2026-05-01" or
 *   "2026-05-01T14:00:00Z").  Parsed as UTC midnight when no time
 *   component is given.
 * @returns Status classification plus elapsed/remaining day counts.
 * @throws {TypeError} When `departureDate` cannot be parsed as a valid date.
 */
export function checkDeadlineStatus(
  departureDate: string,
): DeadlineStatusResult {
  const departure = parseISODate(departureDate);
  const now = Date.now();

  // Whole-day difference (positive = elapsed, negative = future)
  const msElapsed = now - departure.getTime();
  const days_elapsed = Math.floor(msElapsed / MS_PER_DAY);
  const days_remaining = DEADLINE_DAYS - days_elapsed;

  let status: DeadlineStatus;
  if (days_elapsed > DEADLINE_DAYS) {
    status = "CRITICAL";
  } else if (days_elapsed >= WARNING_THRESHOLD) {
    status = "WARNING";
  } else {
    status = "OK";
  }

  return { status, days_remaining, days_elapsed };
}

const DEADLINE_DAYS = 14;
const WARNING_THRESHOLD = 11;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse an ISO 8601 date string strictly.
 * Bare date strings (YYYY-MM-DD) are treated as UTC midnight so results
 * are timezone-independent and deterministic in tests.
 */
function parseISODate(value: string): Date {
  // Append 'Z' to bare date strings (no time component) so they are
  // interpreted as UTC midnight rather than local midnight.
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00Z`
    : value.trim();

  const d = new Date(normalised);
  if (isNaN(d.getTime())) {
    throw new TypeError(
      `Invalid ISO 8601 date string: "${value}". ` +
        `Expected format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ.`,
    );
  }
  return d;
}
