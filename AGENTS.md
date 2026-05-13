# AGENTS.md

## Frontend Rules

- Use React Query for server state and API loading. Do not fetch in `useEffect`.
- Treat new direct `useEffect` / `React.useEffect` usage as banned by default.
- Before adding an effect, prefer render-time derivation, event handlers, or a parent `key` reset.
- Use `src/hooks/useMountEffect.ts` only for true mount/unmount synchronization with an external system.
- Keep direct `src/api/**` imports inside `src/hooks/api/**` so UI code consumes hooks instead of raw API helpers.
- Avoid barrel imports and barrel exports. Import the concrete file instead of `index` re-export layers.
- Prefer named imports. The only allowed namespace import is `import * as React from "react"`.
- Use `@chenglou/pretext` for text-heavy responsive layout, multiline height
  prediction, shrink-wrapped text blocks, and overflow prevention instead of
  DOM measurement loops. Keep text accessible in the DOM, call `prepare()` only
  when the text/font changes, and call `layout()` on width changes.

## Working Style

- Run `bun run lint`, `bun run typecheck`, and `bun run test` before finishing changes.
- Preserve the seeded Next.js, Bun, Tailwind, and React Query baseline instead of re-scaffolding the app.
