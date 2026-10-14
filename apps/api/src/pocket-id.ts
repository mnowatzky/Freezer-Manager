import { env } from "./env";

/**
 * Creates a Pocket ID signup token (admin API, authenticated with an API key)
 * and returns the public signup link. Returns null if no API key is configured
 * or Pocket ID rejects the request, so invites still work for existing users.
 */
export async function createSignupLink(ttlMs: number, usageLimit = 10): Promise<string | null> {
  if (!env.pocketIdApiKey) return null;
  try {
    const res = await fetch(`${env.pocketIdInternalUrl}/api/signup-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": env.pocketIdApiKey },
      body: JSON.stringify({ ttl: Math.floor(ttlMs / 1000), usageLimit }),
    });
    if (!res.ok) {
      console.warn(`Pocket ID signup token request failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const { token } = (await res.json()) as { token: string };
    return `${env.pocketIdUrl}/st/${token}`;
  } catch (err) {
    console.warn("Pocket ID signup token request failed:", err);
    return null;
  }
}
