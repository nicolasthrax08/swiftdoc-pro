/**
 * Minimal ambient type declarations for the `bun:test` module.
 *
 * Bun ships its own test runner; the full type package is `@types/bun`.
 * This stub satisfies tsc for the subset of the API used in SwiftDoc
 * compliance tests without requiring a new devDependency.
 */
declare module "bun:test" {
  type AnyFn = (...args: unknown[]) => unknown;

  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;

  export interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toMatch(pattern: string | RegExp): void;
    toThrow(expected?: unknown): void;
    toContain(item: unknown): void;
    toHaveLength(n: number): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
