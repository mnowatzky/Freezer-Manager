import { de } from "@freezer/shared/i18n";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Centered } from "../components/AuthedLayout";
import { Button, PageHeader } from "../components/ui";
import { authClient, signOut } from "../lib/auth-client";
import { formatDate } from "../lib/format";
import { useFreezerData, type FreezerDetail } from "../lib/freezer-data";
import { useToast } from "../lib/toast";
import { mutators, useCanWrite, useMutate } from "../lib/zero";

export function SettingsPage() {
  const data = useFreezerData();
  const { data: session } = authClient.useSession();
  if (!data.freezer || !session) return <Centered>{de.common.loading}</Centered>;
  return <Settings freezer={data.freezer} userId={session.user.id} />;
}

function Settings({ freezer, userId }: { freezer: FreezerDetail; userId: string }) {
  const navigate = useNavigate();
  const mutate = useMutate();
  const toast = useToast();
  const canWrite = useCanWrite();
  const isOwner = freezer.members.some((m) => m.userId === userId && m.role === "owner");
  const now = Date.now();
  const invites = freezer.invites.filter((i) => i.expiresAt > now);

  const createInvite = async () => {
    const res = await fetch(`/api/freezers/${freezer.id}/invites`, { method: "POST" });
    if (!res.ok) toast(de.errors.notOwner);
    // The new invite row arrives via Zero sync.
  };

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader
        title={`${de.settings.title} · ${freezer.name}`}
        left={
          <Link to="/" className="rounded-lg px-2 py-1 text-xl" aria-label={de.common.back}>
            ←
          </Link>
        }
      />
      <div className="mx-auto max-w-2xl space-y-8 p-4">
        <section>
          <h2 className="mb-2 font-semibold">{de.settings.members}</h2>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
            {freezer.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.user?.name}</div>
                  <div className="truncate text-sm text-slate-500">{m.user?.email}</div>
                </div>
                {m.role === "owner" ? (
                  <span className="text-sm text-slate-500">{de.settings.owner}</span>
                ) : (
                  isOwner && (
                    <Button
                      variant="ghost"
                      disabled={!canWrite}
                      onClick={() => void mutate(mutators.member.remove({ freezerId: freezer.id, userId: m.userId }))}
                    >
                      {de.settings.remove}
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>

        {isOwner && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{de.settings.invites}</h2>
              <Button variant="secondary" disabled={!canWrite} onClick={createInvite}>
                {de.settings.createInvite}
              </Button>
            </div>
            <div className="space-y-4">
              {invites.map((inv) => (
                <InviteCard
                  key={inv.id}
                  token={inv.token}
                  expiresAt={inv.expiresAt}
                  onRevoke={() => void mutate(mutators.invite.revoke({ inviteId: inv.id }))}
                />
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-2">
          <Link to="/etiketten" className="text-brand-dark underline">
            {de.settings.labels}
          </Link>
          <Link to="/setup" className="text-brand-dark underline">
            {de.freezer.newFreezer}
          </Link>
        </section>

        <section className="flex flex-wrap gap-2 border-t border-slate-200 pt-6">
          {isOwner ? (
            <Button
              variant="danger"
              disabled={!canWrite}
              onClick={async () => {
                if (confirm(de.settings.confirmDelete) && (await mutate(mutators.freezer.delete({ freezerId: freezer.id }))))
                  navigate("/", { replace: true });
              }}
            >
              {de.settings.deleteFreezer}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={!canWrite}
              onClick={async () => {
                if (await mutate(mutators.member.leave({ freezerId: freezer.id }))) navigate("/", { replace: true });
              }}
            >
              {de.settings.leave}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void signOut()}>
            {de.auth.signOut}
          </Button>
        </section>
      </div>
    </div>
  );
}

function InviteCard({ token, expiresAt, onRevoke }: { token: string; expiresAt: number; onRevoke: () => void }) {
  const url = `${location.origin}/join/${token}`;
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 240 }).then(setQr);
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:flex-row">
      {qr && <img src={qr} alt="" className="size-40" />}
      <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
        <div className="text-sm text-slate-500">{de.settings.validUntil(formatDate(expiresAt))}</div>
        <div className="truncate font-mono text-xs">{url}</div>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? de.settings.copied : de.settings.copyLink}
          </Button>
          <Button variant="ghost" onClick={onRevoke}>
            {de.settings.revoke}
          </Button>
        </div>
      </div>
    </div>
  );
}
