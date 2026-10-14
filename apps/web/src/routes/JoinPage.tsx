import { de } from "@freezer/shared/i18n";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Centered } from "../components/AuthedLayout";
import { Button } from "../components/ui";
import { authClient, signInWithPocketId } from "../lib/auth-client";

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

  if (info === null || isPending) return <Centered>{de.common.loading}</Centered>;
  if (info === "invalid") return <Centered>{de.join.invalid}</Centered>;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 p-6 text-center">
      <img src="/icon.svg" alt="" className="size-20 rounded-3xl shadow" />
      <h1 className="text-xl font-bold">{de.join.title}</h1>
      <p className="text-slate-600">{de.join.invitedTo(info.freezerName)}</p>
      {session ? (
        <Button className="w-full" disabled={joining} onClick={accept}>
          {de.join.accept}
        </Button>
      ) : (
        <div className="grid w-full gap-3">
          <Button onClick={() => void signInWithPocketId(`/join/${token}`)}>{de.join.haveAccount}</Button>
          {info.signupUrl && (
            <>
              <a
                href={info.signupUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold ring-1 ring-slate-300"
              >
                {de.join.createAccount}
              </a>
              <p className="text-sm text-slate-500">{de.join.createAccountHint}</p>
            </>
          )}
        </div>
      )}
    </main>
  );
}
