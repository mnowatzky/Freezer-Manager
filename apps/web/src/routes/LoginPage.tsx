import { de } from "@freezer/shared/i18n";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Button, Icon, TextField } from "../components/m3";
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
      <Registration />
    </main>
  );
}

/**
 * Self-registration for people without an account: shown only when the server has a
 * registration code configured. A valid code yields a single-use Pocket ID signup link.
 */
function Registration() {
  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupUrl, setSignupUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/register")
      .then(async (res) => res.ok && setEnabled(((await res.json()) as { enabled: boolean }).enabled))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) setSignupUrl(((await res.json()) as { signupUrl: string }).signupUrl);
      else if (res.status === 403) setError(de.auth.invalidCode);
      else if (res.status === 429) setError(de.auth.tooManyAttempts);
      else setError(de.errors.generic);
    } catch {
      setError(de.errors.network);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;
  return (
    <motion.section
      className="mt-4 w-full max-w-xs border-t border-outline-variant pt-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...motionScheme.slowSpatial, delay: 0.3 }}
    >
      <h2 className="type-title-medium">{de.auth.noAccount}</h2>
      <AnimatePresence mode="wait" initial={false}>
        {signupUrl ? (
          <motion.div
            key="ready"
            className="mt-3 flex flex-col items-center gap-3"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={motionScheme.defaultSpatial}
          >
            <p className="type-body-medium text-on-surface-variant">{de.auth.registerReady}</p>
            <a
              href={signupUrl}
              className="state-layer type-label-large inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-on-primary"
            >
              <Icon name="person_add" size={20} />
              {de.auth.continueToPocketId}
            </a>
            <p className="type-body-small text-on-surface-variant">{de.auth.registerNext}</p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={(e) => void submit(e)}
            className="mt-3 flex flex-col gap-3 text-left"
            exit={{ opacity: 0, scale: 0.96 }}
            transition={motionScheme.fastEffects}
          >
            <p className="type-body-medium text-center text-on-surface-variant">{de.auth.registerIntro}</p>
            <TextField
              label={de.auth.registrationCode}
              value={code}
              autoComplete="off"
              autoCapitalize="none"
              leadingIcon="key"
              onChange={(e) => setCode(e.target.value)}
              supporting={error ? <span role="alert" className="text-error">{error}</span> : undefined}
            />
            <Button type="submit" variant="tonal" icon="person_add" disabled={busy || !code.trim()}>
              {de.auth.register}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.section>
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
