import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated endpoints: state-changing requests must come
 * from the app's own origin. SameSite=Lax alone isn't enough, because every subdomain of
 * the parent domain counts as "same site".
 *
 * Browsers send `Origin` on every cross-origin and same-origin POST from fetch; if it's
 * missing we fall back to `Sec-Fetch-Site`. Requests with neither (non-browser clients)
 * can't carry a victim's cookies, but they have no business here either, so they're rejected.
 */
export function sameOriginOnly(allowedOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    const allowed = origin ? origin === allowedOrigin : c.req.header("sec-fetch-site") === "same-origin";
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    return next();
  };
}
