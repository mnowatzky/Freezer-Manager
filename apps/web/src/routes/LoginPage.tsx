import { de } from "@freezer/shared/i18n";
import { motion } from "motion/react";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Button } from "../components/m3";
import { authClient, signInWithPocketId } from "../lib/auth-client";
import { motionScheme } from "../theme/motion";

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={returnTo} replace />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <BrandMark />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionScheme.slowSpatial, delay: 0.1 }}>
        <h1 className="type-display-small type-emphasized">{de.appName}</h1>
        <p className="type-body-large mx-auto mt-2 max-w-xs text-on-surface-variant">{de.auth.intro}</p>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionScheme.slowSpatial, delay: 0.2 }}>
        <Button
          size="m"
          icon="passkey"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signInWithPocketId(returnTo).finally(() => setBusy(false));
          }}
        >
          {de.auth.signIn}
        </Button>
      </motion.div>
    </main>
  );
}

/** App icon that springs in and gently morphs its corner shape (Expressive brand moment). */
export function BrandMark({ size = 112 }: { size?: number }) {
  return (
    <motion.img
      src="/icon.svg"
      alt=""
      style={{ width: size, height: size }}
      initial={{ scale: 0.6, opacity: 0, borderRadius: size / 2 }}
      animate={{ scale: 1, opacity: 1, borderRadius: [size / 2, size * 0.28, size * 0.36, size * 0.28] }}
      transition={{ ...motionScheme.slowSpatial, borderRadius: { duration: 1.6, ease: "easeInOut" } }}
    />
  );
}

// Only allow in-app paths to avoid open redirects.
export function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
