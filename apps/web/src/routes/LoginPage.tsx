import { de } from "@freezer/shared/i18n";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Button } from "../components/ui";
import { authClient, signInWithPocketId } from "../lib/auth-client";

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={returnTo} replace />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <img src="/icon.svg" alt="" className="size-24 rounded-3xl shadow" />
      <h1 className="text-2xl font-bold">{de.appName}</h1>
      <p className="max-w-xs text-slate-600">{de.auth.intro}</p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signInWithPocketId(returnTo).finally(() => setBusy(false));
        }}
      >
        {de.auth.signIn}
      </Button>
    </main>
  );
}

// Only allow in-app paths to avoid open redirects.
export function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
