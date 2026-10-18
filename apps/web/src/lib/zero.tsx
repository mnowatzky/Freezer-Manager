import "@freezer/shared/context";
import { mutators } from "@freezer/shared/mutators";
import { schema } from "@freezer/shared/zero-schema";
import { useConnectionState, useZero, ZeroProvider } from "@rocicorp/zero/react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { errorMessage } from "@freezer/shared/i18n";
import { t } from "./i18n";
import { useToast } from "./toast";

// The production image injects the zero-cache URL into index.html at runtime, so one image works for
// any domain. The placeholder stays when index.html isn't served by that nginx (dev server).
const injectedCacheURL = document.querySelector<HTMLMetaElement>('meta[name="zero-cache-url"]')?.content;
const cacheURL =
  injectedCacheURL && injectedCacheURL !== "__ZERO_ORIGIN__" ? injectedCacheURL : import.meta.env.VITE_ZERO_CACHE_URL;

export function ZeroRoot({ userID, children }: { userID: string; children: ReactNode }) {
  // ZeroProvider recreates the Zero instance when any prop changes identity, so keep context stable.
  const context = useMemo(() => ({ userID }), [userID]);
  return (
    <ZeroProvider
      cacheURL={cacheURL}
      userID={userID}
      context={context}
      schema={schema}
      mutators={mutators}
    >
      <SessionWatch />
      {children}
    </ZeroProvider>
  );
}

// zero-cache reports needs-auth when the API rejects the forwarded session cookie.
function SessionWatch() {
  const state = useConnectionState();
  useEffect(() => {
    if (state.name === "needs-auth") {
      window.location.assign(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
    }
  }, [state.name]);
  return null;
}

/** Writes are possible while connected; while connecting they are queued (briefly) by Zero. */
export function useCanWrite() {
  const state = useConnectionState();
  return state.name === "connected" || state.name === "connecting";
}

type MutateArg = Parameters<ReturnType<typeof useZero>["mutate"]>[0];

/** Runs a mutator and surfaces client/server errors as a toast. Resolves true on client success. */
export function useMutate() {
  const zero = useZero();
  const toast = useToast();
  return useCallback(
    async (request: MutateArg) => {
      const result = zero.mutate(request);
      const client = await result.client;
      if (client.type === "error") {
        toast(errorMessage(t, client.error));
        return false;
      }
      // Only app errors (e.g. a permission check failing on the server) are worth showing;
      // transport errors are covered by the offline banner.
      void result.server.then((r) => r.type === "error" && r.error.type === "app" && toast(errorMessage(t, r.error)));
      return true;
    },
    [zero, toast],
  );
}

export { mutators };
