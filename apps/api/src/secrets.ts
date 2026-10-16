import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a provided secret with the expected one. Both are hashed
 * first, so neither the content nor the length of the expected secret leaks via timing.
 */
export function secretsEqual(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
