import type { Context } from "hono";

/** Client IP as forwarded by the reverse proxy (NPM sets X-Forwarded-For). */
export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Fixed-window, in-memory rate limiter keyed by e.g. client IP. Good enough for a single API
 * instance; `allow()` returns false once `limit` hits within `windowMs` were used up.
 */
export function rateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    allow(key: string): boolean {
      const now = Date.now();
      if (windows.size > 1000) for (const [k, w] of windows) if (w.resetAt < now) windows.delete(k);
      const w = windows.get(key);
      if (!w || w.resetAt < now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      return ++w.count <= limit;
    },
  };
}
