import { de } from "@freezer/shared/i18n";
import { useConnectionState } from "@rocicorp/zero/react";
import { AnimatePresence, motion } from "motion/react";
import { Navigate, useLocation, useOutlet } from "react-router";
import { authClient } from "../lib/auth-client";
import { ZeroRoot } from "../lib/zero";
import { motionScheme } from "../theme/motion";
import { Icon, LoadingIndicator } from "./m3";

export function AuthedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();

  // Don't unmount Zero during a background session refetch.
  if (isPending && !session) return <FullScreenLoading />;
  if (!session) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return (
    <ZeroRoot userID={session.user.id}>
      <OfflineBanner />
      <AnimatedOutlet />
    </ZeroRoot>
  );
}

/**
 * Fade-through between routes (M3 pattern for unrelated screens). Opacity only:
 * a transform here would break the pages' fixed FABs and sticky app bars.
 */
function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: motionScheme.defaultEffects }}
        exit={{ opacity: 0, transition: motionScheme.fastEffects }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

function OfflineBanner() {
  const state = useConnectionState();
  const offline = state.name !== "connected" && state.name !== "connecting";
  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          role="status"
          className="sticky top-0 z-40 overflow-hidden bg-error-container text-on-error-container"
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          transition={motionScheme.defaultSpatial}
        >
          <div className="type-label-large flex items-center justify-center gap-2 px-4 py-2.5">
            <Icon name="cloud_off" size={20} />
            {de.offline}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FullScreenLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingIndicator label={de.common.loading} />
    </div>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="type-body-large flex min-h-dvh items-center justify-center p-6 text-on-surface-variant">{children}</div>;
}
