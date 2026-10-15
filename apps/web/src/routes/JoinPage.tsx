import { de } from "@freezer/shared/i18n";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Centered, FullScreenLoading } from "../components/AuthedLayout";
import { Button, Icon } from "../components/m3";
import { authClient, signInWithPocketId } from "../lib/auth-client";
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
  const [info, setInfo] = useState<InviteInfo | null | "invalid">(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    void fetch(`/api/invites/${encodeURIComponent(token)}`).then(async (res) =>
      setInfo(res.ok ? ((await res.json()) as InviteInfo) : "invalid"),
    );
  }, [token]);

  const accept = async () => {
    setJoining(true);
    const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
    if (!res.ok) {
      setJoining(false);
      setInfo("invalid");
      return;
    }
    const { freezerId } = (await res.json()) as { freezerId: string };
    try {
      localStorage.setItem("activeFreezerId", freezerId);
    } catch {
      // ignore
    }
    navigate("/", { replace: true });
  };

  if (info === null || isPending) return <FullScreenLoading />;
  if (info === "invalid")
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <Icon name="error" size={40} className="text-error" />
          {de.join.invalid}
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
          <Button size="m" icon="group" className="w-full" disabled={joining} onClick={accept}>
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
