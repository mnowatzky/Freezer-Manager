import { createAuthClient } from "better-auth/react";

// Same-origin: /api is proxied to the API (Vite in dev, NPM in prod).
export const authClient = createAuthClient({ basePath: "/api/auth" });

export function signInWithPocketId(returnTo = "/") {
  return authClient.signIn.social({ provider: "pocket-id", callbackURL: returnTo });
}

export async function signOut() {
  await authClient.signOut();
  window.location.assign("/login");
}
