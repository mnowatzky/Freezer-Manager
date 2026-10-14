import { de } from "@freezer/shared/i18n";
import { useConnectionState } from "@rocicorp/zero/react";
import { Navigate, Outlet, useLocation } from "react-router";
import { authClient } from "../lib/auth-client";
import { ZeroRoot } from "../lib/zero";

export function AuthedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();

  // Don't unmount Zero during a background session refetch.
  if (isPending && !session) return <Centered>{de.common.loading}</Centered>;
  if (!session) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return (
    <ZeroRoot userID={session.user.id}>
      <OfflineBanner />
      <Outlet />
    </ZeroRoot>
  );
}

function OfflineBanner() {
  const state = useConnectionState();
  if (state.name === "connected" || state.name === "connecting") return null;
  return <div className="sticky top-0 z-40 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">{de.offline}</div>;
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-slate-500">{children}</div>;
}
