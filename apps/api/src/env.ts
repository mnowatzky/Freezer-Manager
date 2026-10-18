function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  /** Public origin of the web app; Better Auth callbacks are served under it at /api/auth. */
  webOrigin: required("WEB_ORIGIN"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  /** Parent domain for the session cookie so zero-cache's subdomain receives it (prod only). */
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  /** Public Pocket ID URL (issuer, used by browsers). */
  pocketIdUrl: required("POCKET_ID_URL").replace(/\/$/, ""),
  /** URL the API uses to reach Pocket ID (may be an internal Docker hostname). Defaults to POCKET_ID_URL. */
  pocketIdInternalUrl: (process.env.POCKET_ID_INTERNAL_URL || required("POCKET_ID_URL")).replace(/\/$/, ""),
  pocketIdClientId: required("POCKET_ID_CLIENT_ID"),
  pocketIdClientSecret: required("POCKET_ID_CLIENT_SECRET"),
  /** Admin API key for creating signup tokens; invites work without it (no signup link). */
  pocketIdApiKey: process.env.POCKET_ID_API_KEY || undefined,
  /** Pocket ID group IDs that people signing up via an invite join (comma-separated, optional). */
  pocketIdSignupGroupIds: (process.env.POCKET_ID_SIGNUP_GROUP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  /** Code that unlocks self-registration on the login page (optional; unset = invite-only). */
  registrationCode: process.env.REGISTRATION_CODE?.trim() || undefined,
  /** Shared secret zero-cache sends as X-Api-Key on /api/zero/* calls. */
  zeroApiKey: required("ZERO_API_KEY"),
};
