import { defineConfig, globalIgnores } from "eslint/config";
import nextVitalsConfig from "eslint-config-next/core-web-vitals";
import frontendReactRules from "./eslint-rules/frontend-react-rules.mjs";

const useEffectRestrictionMessage =
  "Avoid useEffect. Prefer derived state during render, event handlers, React Query or existing data hooks, and useMountEffect only for mount-only side effects.";

export default defineConfig([
  ...nextVitalsConfig,
  {
    plugins: {
      superoptimizers: frontendReactRules,
    },
    rules: {
      "react/jsx-max-depth": ["error", { max: 7 }],
      "superoptimizers/no-data-fetching-in-use-effect": "warn",
      "superoptimizers/max-use-effects-per-function": ["warn", { max: 3 }],
      "superoptimizers/no-barrel-imports": "warn",
      "superoptimizers/no-barrel-exports": "error",
      "superoptimizers/api-imports-only-in-hooks": "warn",
      "superoptimizers/no-namespace-imports-except-react": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name='useEffect']",
          message: useEffectRestrictionMessage,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='React'][callee.property.type='Identifier'][callee.property.name='useEffect'][callee.computed=false]",
          message: useEffectRestrictionMessage,
        },
      ],
      "superoptimizers/no-use-effect-aliases": "error",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
