import { env } from "./env";
import { errorFields, log } from "./log";

/**
 * Creates a Pocket ID signup token (admin API, authenticated with an API key)
 * and returns the public signup link. Accounts created with it join the groups in
 * POCKET_ID_SIGNUP_GROUP_IDS, e.g. a "freezer" group that only grants access to this app. Returns null if no API key is configured
 * or Pocket ID rejects the request, so invites still work for existing users.
 */
export async function createSignupLink(ttlMs: number, usageLimit = 10): Promise<string | null> {
  if (!env.pocketIdApiKey) return null;
  try {
    const res = await fetch(`${env.pocketIdInternalUrl}/api/signup-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": env.pocketIdApiKey },
      body: JSON.stringify({ ttl: Math.floor(ttlMs / 1000), usageLimit, userGroupIds: env.pocketIdSignupGroupIds }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log("warn", "Pocket ID signup token request failed", { status: res.status, body: await res.text() });
      return null;
    }
    const { token } = (await res.json()) as { token: string };
    return `${env.pocketIdUrl}/st/${token}`;
  } catch (err) {
    log("warn", "Pocket ID signup token request failed", errorFields(err));
    return null;
  }
}
