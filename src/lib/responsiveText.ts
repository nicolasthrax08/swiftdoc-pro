import { layout, prepare } from "@chenglou/pretext";

export const DEFAULT_RESPONSIVE_TEXT_FONT_FAMILY =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

export interface ResponsiveTextMetrics {
  heightPx: number;
  lineCount: number;
}

interface PrepareResponsiveTextOptions {
  fontFamily?: string;
  fontSizePx: number;
  fontWeight?: number | string;
  letterSpacingPx?: number;
  lineHeightPx: number;
  whiteSpace?: "normal" | "pre-wrap";
}

export function prepareResponsiveText(
  text: string,
  {
    fontFamily = DEFAULT_RESPONSIVE_TEXT_FONT_FAMILY,
    fontSizePx,
    fontWeight = 400,
    letterSpacingPx = 0,
    lineHeightPx,
    whiteSpace = "normal",
  }: PrepareResponsiveTextOptions,
): (maxWidthPx: number) => ResponsiveTextMetrics {
  const prepared = prepare(text, `${fontWeight} ${fontSizePx}px ${fontFamily}`, {
    letterSpacing: letterSpacingPx,
    whiteSpace,
  });

  return (maxWidthPx: number) => {
    if (maxWidthPx <= 0 || text.length === 0) {
      return { heightPx: lineHeightPx, lineCount: 1 };
    }

    const result = layout(prepared, maxWidthPx, lineHeightPx);
    const lineCount = Math.max(result.lineCount, 1);

    return {
      heightPx: Math.max(result.height, lineHeightPx),
      lineCount,
    };
  };
}
