import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { db, schema } from "./db";
import { env } from "./env";

export const POCKET_ID_PROVIDER = "pocket-id";

export const auth = betterAuth({
  baseURL: env.webOrigin,
  basePath: "/api/auth",
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  // No local passwords: Pocket ID (passkeys) is the only way in.
  emailAndPassword: { enabled: false },
  trustedOrigins: [env.webOrigin],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: env.cookieDomain
    ? { crossSubDomainCookies: { enabled: true, domain: env.cookieDomain } }
    : undefined,
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: POCKET_ID_PROVIDER,
          discoveryUrl: `${env.pocketIdInternalUrl}/.well-known/openid-configuration`,
          clientId: env.pocketIdClientId,
          clientSecret: env.pocketIdClientSecret,
          scopes: ["openid", "profile", "email"],
          pkce: true,
        },
      ],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
