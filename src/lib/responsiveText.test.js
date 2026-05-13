import { afterEach, expect, mock, test } from "bun:test";

const layoutCalls = [];

mock.module("@chenglou/pretext", () => ({
  layout: (preparedText, maxWidthPx, lineHeightPx) => {
    const lineCount = preparedText.text.split("\n").length;
    layoutCalls.push({ lineCount, maxWidthPx, preparedText });

    return {
      height: lineCount * lineHeightPx,
      lineCount,
    };
  },
  prepare: (text, font, options) => ({ font, options, text }),
}));

const { prepareResponsiveText } = await import("./responsiveText");

afterEach(() => {
  layoutCalls.length = 0;
});

test("pre-wrap whitespace-only text preserves hard blank lines", () => {
  const measureText = prepareResponsiveText("  \n  \n  ", {
    fontSizePx: 18,
    lineHeightPx: 32,
    whiteSpace: "pre-wrap",
  });

  expect(measureText(320)).toEqual({ heightPx: 96, lineCount: 3 });
  expect(layoutCalls).toHaveLength(1);
  expect(layoutCalls[0].preparedText.options.whiteSpace).toBe("pre-wrap");
});

test("truly empty text reserves one browser-like line without layout", () => {
  const measureText = prepareResponsiveText("", {
    fontSizePx: 18,
    lineHeightPx: 32,
    whiteSpace: "pre-wrap",
  });

  expect(measureText(320)).toEqual({ heightPx: 32, lineCount: 1 });
  expect(layoutCalls).toHaveLength(0);
});
