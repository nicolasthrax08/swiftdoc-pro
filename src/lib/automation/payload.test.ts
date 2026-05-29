import { describe, expect, it } from "bun:test";
import {
  AutomationPayloadValidationError,
  mapValidatedCodesToTdecExportFields,
} from "./payload";

describe("mapValidatedCodesToTdecExportFields", () => {
  it("maps valid HKHS and tax", () => {
    expect(mapValidatedCodesToTdecExportFields("42022190", 30.5)).toEqual({
      hs_code: "42022190",
      ad_valorem_tax_hkd: 30.5,
    });
  });

  it("trims hkhs_code", () => {
    expect(mapValidatedCodesToTdecExportFields("  42022190  ", 0.2)).toEqual({
      hs_code: "42022190",
      ad_valorem_tax_hkd: 0.2,
    });
  });

  it("rejects invalid HKHS", () => {
    expect(() =>
      mapValidatedCodesToTdecExportFields("4202219", 1),
    ).toThrow(AutomationPayloadValidationError);
  });

  it("rejects negative tax", () => {
    expect(() =>
      mapValidatedCodesToTdecExportFields("42022190", -1),
    ).toThrow(AutomationPayloadValidationError);
  });
});
