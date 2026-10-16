import { de } from "@freezer/shared/i18n";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FullScreenLoading } from "../components/AuthedLayout";
import { Button, Icon, IconButton, ListGroup, ListItem, TopAppBar } from "../components/m3";
import { authClient, signOut } from "../lib/auth-client";
import { formatDate } from "../lib/format";
import { useFreezerData, type FreezerDetail } from "../lib/freezer-data";
import { useToast } from "../lib/toast";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { motionScheme } from "../theme/motion";

export function SettingsPage() {
  const data = useFreezerData();
  const { data: session } = authClient.useSession();
  if (!data.freezer || !session) return <FullScreenLoading />;
  return <Settings freezer={data.freezer} userId={session.user.id} />;
}

function Settings({ freezer, userId }: { freezer: FreezerDetail; userId: string }) {
  const navigate = useNavigate();
  const mutate = useMutate();
  const toast = useToast();
  const canWrite = useCanWrite();
  const isOwner = freezer.members.some((m) => m.userId === userId && m.role === "owner");
  // Owner-only query: members never receive invite tokens or signup links.
  const [allInvites] = useQuery(isOwner && queries.freezers.invites({ freezerId: freezer.id }));
  const [now] = useState(() => Date.now());
  const invites = (allInvites ?? []).filter((i) => i.expiresAt > now);
  const [creating, setCreating] = useState(false);

  const createInvite = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/freezers/${freezer.id}/invites`, { method: "POST" });
      if (res.status === 403) toast(de.errors.notOwner);
      else if (!res.ok) toast(de.errors.generic);
      // On success the new invite row arrives via Zero sync.
    } catch {
      toast(de.errors.network);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-dvh pb-12">
      <TopAppBar
        title={de.settings.title}
        subtitle={freezer.name}
        navigation={<IconButton icon="arrow_back" label={de.common.back} onClick={() => void navigate("/")} />}
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4">
        <section>
          <SectionTitle icon="group">{de.settings.members}</SectionTitle>
          <ListGroup>
            <AnimatePresence initial={false}>
              {freezer.members.map((m) => (
                <ListItem
                  key={m.userId}
                  leading={
                    <span className="type-title-medium flex size-10 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container">
                      {m.user?.name.charAt(0).toUpperCase()}
                    </span>
                  }
                  headline={m.user?.name}
                  supporting={m.role === "owner" ? `${de.settings.owner} · ${m.user?.email}` : m.user?.email}
                  trailing={
                    m.role !== "owner" &&
                    isOwner && (
                      <IconButton
                        icon="person_remove"
                        label={de.settings.remove}
                        disabled={!canWrite}
                        onClick={() => void mutate(mutators.member.remove({ freezerId: freezer.id, userId: m.userId }))}
                      />
                    )
                  }
                />
              ))}
            </AnimatePresence>
          </ListGroup>
        </section>

        {isOwner && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionTitle icon="person_add" className="mb-0">
                {de.settings.invites}
              </SectionTitle>
              <Button variant="tonal" icon="add" disabled={!canWrite || creating} onClick={() => void createInvite()}>
                {de.settings.createInvite}
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {invites.map((inv) => (
                  <InviteCard
                    key={inv.id}
                    token={inv.token}
                    expiresAt={inv.expiresAt}
                    onRevoke={() => void mutate(mutators.invite.revoke({ inviteId: inv.id }))}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        <section>
          <ListGroup>
            <ListItem leading={<Icon name="print" className="text-primary" />} headline={de.settings.labels} onClick={() => void navigate("/etiketten")} />
            <ListItem leading={<Icon name="add" className="text-primary" />} headline={de.freezer.newFreezer} onClick={() => void navigate("/setup")} />
            <ListItem leading={<Icon name="logout" className="text-primary" />} headline={de.auth.signOut} onClick={() => void signOut()} />
          </ListGroup>
        </section>

        <section>
          {isOwner ? (
            <Button
              variant="error"
              icon="delete"
              disabled={!canWrite}
              onClick={() => {
                if (!confirm(de.settings.confirmDelete)) return;
                void mutate(mutators.freezer.delete({ freezerId: freezer.id })).then(
                  (ok) => ok && navigate("/", { replace: true }),
                );
              }}
            >
              {de.settings.deleteFreezer}
            </Button>
          ) : (
            <Button
              variant="error"
              icon="logout"
              disabled={!canWrite}
              onClick={() =>
                void mutate(mutators.member.leave({ freezerId: freezer.id })).then(
                  (ok) => ok && navigate("/", { replace: true }),
                )
              }
            >
              {de.settings.leave}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children, className = "mb-3" }: { icon: string; children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`type-title-medium flex items-center gap-2 px-1 text-primary ${className}`}>
      <Icon name={icon} size={20} />
      {children}
    </h2>
  );
}

function InviteCard({ token, expiresAt, onRevoke }: { token: string; expiresAt: number; onRevoke: () => void }) {
  const url = `${location.origin}/join/${token}`;
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    void QRCode.toDataURL(url, { margin: 1, width: 280, color: dark ? { dark: "#dde7e9", light: "#00000000" } : { dark: "#2a3435", light: "#00000000" } }).then(setQr);
  }, [url]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: motionScheme.fastEffects }}
      transition={motionScheme.defaultSpatial}
      className="flex flex-col items-center gap-4 rounded-xl bg-surface-container p-5 sm:flex-row"
    >
      {qr && <img src={qr} alt="" className="size-44 rounded-l bg-surface-container-lowest p-2 dark:bg-transparent" />}
      <div className="flex w-full min-w-0 flex-1 flex-col gap-2 text-center sm:text-left">
        <div className="type-label-large text-on-surface-variant">{de.settings.validUntil(formatDate(expiresAt))}</div>
        <div className="type-body-small truncate font-mono text-on-surface-variant">{url}</div>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Button
            variant="tonal"
            icon={copied ? "check" : "content_copy"}
            onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
          >
            {copied ? de.settings.copied : de.settings.copyLink}
          </Button>
          <Button variant="text" onClick={onRevoke}>
            {de.settings.revoke}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
