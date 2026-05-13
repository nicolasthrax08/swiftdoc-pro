import { type EffectCallback, useEffect } from "react";

export function useMountEffect(effect: EffectCallback): void {
  /* eslint-disable no-restricted-syntax */

  // This helper intentionally runs exactly once on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: This helper intentionally runs once on mount.
  useEffect(effect, []); // eslint-disable-line react-hooks/exhaustive-deps
}
