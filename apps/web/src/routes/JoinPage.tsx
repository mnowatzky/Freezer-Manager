import { de } from "@freezer/shared/i18n";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Centered, FullScreenLoading } from "../components/AuthedLayout";
import { Button, Icon } from "../components/m3";
import { authClient, signInWithPocketId } from "../lib/auth-client";
import { useToast } from "../lib/toast";
import { motionScheme } from "../theme/motion";
import { BrandMark } from "./LoginPage";

type InviteInfo = { freezerName: string; signupUrl: string | null };

/**
 * `/join/:token` – works logged out: shows the freezer name, a sign-in button
 * and (for new people) the Pocket ID signup link. After sign-in the user comes
 * back here and joins.
 */
export function JoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [info, setInfo] = useState<InviteInfo | null | "invalid" | "error">(null);
  const [joining, setJoining] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) setInfo("invalid");
        else if (!res.ok) setInfo("error");
        else setInfo((await res.json()) as InviteInfo);
      })
      .catch(() => !cancelled && setInfo("error"));
    return () => {
      cancelled = true;
    };
    // `attempt` is the retry trigger: bumping it re-runs this fetch.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [token, attempt]);

  const accept = async () => {
    setJoining(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
      if (res.status === 404) return setInfo("invalid");
      if (!res.ok) return toast(de.errors.generic);
      const { freezerId } = (await res.json()) as { freezerId: string };
      try {
        localStorage.setItem("activeFreezerId", freezerId);
      } catch {
        // ignore
      }
      void navigate("/", { replace: true });
    } catch {
      toast(de.errors.network);
    } finally {
      setJoining(false);
    }
  };

  if (info === null || isPending) return <FullScreenLoading />;
  if (info === "invalid" || info === "error")
    return (
      <Centered>
        <div className="flex max-w-xs flex-col items-center gap-4 text-center">
          <Icon name="error" size={40} className="text-error" />
          {info === "invalid" ? de.join.invalid : de.errors.network}
          {info === "error" ? (
            <Button variant="tonal" icon="refresh" onClick={() => {
                setInfo(null);
                setAttempt((n) => n + 1);
              }}>
              {de.common.retry}
            </Button>
          ) : (
            <Button variant="tonal" icon="arrow_forward" onClick={() => void navigate("/", { replace: true })}>
              {de.join.toApp}
            </Button>
          )}
        </div>
      </Centered>
    );

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6 text-center">
      <BrandMark size={88} />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionScheme.slowSpatial, delay: 0.1 }}>
        <h1 className="type-headline-medium type-emphasized">{de.join.title}</h1>
        <p className="type-body-large mt-2 text-on-surface-variant">{de.join.invitedTo(info.freezerName)}</p>
      </motion.div>
      <motion.div
        className="flex w-full flex-col gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionScheme.slowSpatial, delay: 0.2 }}
      >
        {session ? (
          <Button size="m" icon="group" className="w-full" disabled={joining} onClick={() => void accept()}>
            {de.join.accept}
          </Button>
        ) : (
          <>
            <Button size="m" icon="passkey" className="w-full" onClick={() => void signInWithPocketId(`/join/${token}`)}>
              {de.join.haveAccount}
            </Button>
            {info.signupUrl && (
              <>
                <a
                  href={info.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="state-layer type-title-medium flex h-14 items-center justify-center gap-2 rounded-full text-on-surface-variant ring-1 ring-outline-variant ring-inset"
                >
                  <Icon name="person_add" />
                  {de.join.createAccount}
                </a>
                <p className="type-body-small text-on-surface-variant">{de.join.createAccountHint}</p>
              </>
            )}
          </>
        )}
      </motion.div>
    </main>
  );
}
