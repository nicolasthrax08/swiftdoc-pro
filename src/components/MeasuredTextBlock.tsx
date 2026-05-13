"use client";

import { useLayoutEffect, useRef, useState } from "react";

import {
  DEFAULT_RESPONSIVE_TEXT_FONT_FAMILY,
  prepareResponsiveText,
} from "@/lib/responsiveText";

interface MeasuredTextBlockProps {
  className?: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number | string;
  initialLineCount?: number;
  lineHeightPx?: number;
  text: string;
}

export function MeasuredTextBlock({
  className,
  fontFamily = DEFAULT_RESPONSIVE_TEXT_FONT_FAMILY,
  fontSizePx = 18,
  fontWeight = 400,
  initialLineCount = 6,
  lineHeightPx = 32,
  text,
}: MeasuredTextBlockProps) {
  const blockRef = useRef<HTMLParagraphElement>(null);
  const [reservedHeightPx, setReservedHeightPx] = useState(
    lineHeightPx * initialLineCount,
  );

  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block) {
      return undefined;
    }

    let isActive = true;
    let measureText = prepareResponsiveText(text, {
      fontFamily,
      fontSizePx,
      fontWeight,
      lineHeightPx,
    });

    const updateHeight = (widthPx: number) => {
      const metrics = measureText(widthPx);
      if (isActive) {
        setReservedHeightPx(metrics.heightPx);
      }
    };

    const rebuildMeasurement = () => {
      measureText = prepareResponsiveText(text, {
        fontFamily,
        fontSizePx,
        fontWeight,
        lineHeightPx,
      });
      updateHeight(block.clientWidth);
    };

    updateHeight(block.clientWidth);

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            const entry = entries[0];
            updateHeight(entry?.contentRect.width ?? block.clientWidth);
          });
    observer?.observe(block);

    const fontSet = "fonts" in document ? document.fonts : undefined;
    const handleFontsLoaded = () => {
      if (isActive) {
        rebuildMeasurement();
      }
    };

    if (fontSet) {
      void fontSet.ready.then(handleFontsLoaded);
      fontSet.addEventListener("loadingdone", handleFontsLoaded);
    }

    return () => {
      isActive = false;
      observer?.disconnect();
      fontSet?.removeEventListener("loadingdone", handleFontsLoaded);
    };
  }, [fontFamily, fontSizePx, fontWeight, lineHeightPx, text]);

  return (
    <p
      ref={blockRef}
      className={className}
      style={{
        fontFamily,
        fontSize: `${fontSizePx}px`,
        fontWeight,
        lineHeight: `${lineHeightPx}px`,
        minHeight: `${reservedHeightPx}px`,
      }}
    >
      {text}
    </p>
  );
}
