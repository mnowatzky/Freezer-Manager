import { t } from "../lib/i18n";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { parseImport, type ParsedImport } from "@freezer/shared/import";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { FullScreenLoading } from "../components/AuthedLayout";
import { Button, Icon, IconButton, ListGroup, ListItem, Sheet, Switch, TextField, TopAppBar } from "../components/m3";
import { authClient, signOut } from "../lib/auth-client";
import { formatDate } from "../lib/format";
import { useFreezerData, type FreezerDetail } from "../lib/freezer-data";
import { ApiTokens } from "../components/ApiTokens";
import { ImportSheet } from "../components/ImportSheet";
import { exportFreezer } from "../lib/export";
import { usePush } from "../lib/push";
import { useToast } from "../lib/toast";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { motionScheme } from "../theme/motion";

export function SettingsPage() {
  const data = useFreezerData();
  const { data: session } = authClient.useSession();
  if (!data.freezer || !session) return <FullScreenLoading />;
  return <Settings freezer={data.freezer} userId={session.user.id} onSwitchFreezer={data.setActiveId} />;
}

function Settings({ freezer, userId, onSwitchFreezer }: { freezer: FreezerDetail; userId: string; onSwitchFreezer: (id: string) => void }) {
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
  const [renaming, setRenaming] = useState(false);

  const createInvite = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/freezers/${freezer.id}/invites`, { method: "POST" });
      if (res.status === 403) toast(t.errors.notOwner);
      else if (!res.ok) toast(t.errors.generic);
      // On success the new invite row arrives via Zero sync.
    } catch {
      toast(t.errors.network);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-dvh pb-12">
      <TopAppBar
        title={t.settings.title}
        subtitle={freezer.name}
        navigation={<IconButton icon="arrow_back" label={t.common.back} onClick={() => void navigate("/")} />}
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4">
        <section>
          <SectionTitle icon="group">{t.settings.members}</SectionTitle>
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
                  supporting={m.role === "owner" ? `${t.settings.owner} · ${m.user?.email}` : m.user?.email}
                  trailing={
                    m.role !== "owner" &&
                    isOwner && (
                      <IconButton
                        icon="person_remove"
                        label={t.settings.remove}
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
                {t.settings.invites}
              </SectionTitle>
              <Button variant="tonal" icon="add" disabled={!canWrite || creating} onClick={() => void createInvite()}>
                {t.settings.createInvite}
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

        <DataSection freezer={freezer} onSwitchFreezer={onSwitchFreezer} />

        <ApiTokens
          title={
            <SectionTitle icon="api" className="mb-0">
              {t.tokens.title}
            </SectionTitle>
          }
        />

        <Notifications />

        <section>
          <ListGroup>
            {isOwner && (
              <ListItem
                leading={<Icon name="edit" className="text-primary" />}
                headline={t.settings.renameFreezer}
                supporting={freezer.name}
                onClick={() => setRenaming(true)}
              />
            )}
            <ListItem leading={<Icon name="print" className="text-primary" />} headline={t.settings.labels} onClick={() => void navigate("/labels")} />
            <ListItem leading={<Icon name="add" className="text-primary" />} headline={t.freezer.newFreezer} onClick={() => void navigate("/setup")} />
            <ListItem leading={<Icon name="logout" className="text-primary" />} headline={t.auth.signOut} onClick={() => void signOut()} />
          </ListGroup>
          <Sheet open={renaming} title={t.settings.renameFreezer} onClose={() => setRenaming(false)}>
            <RenameFreezer freezer={freezer} onDone={() => setRenaming(false)} />
          </Sheet>
        </section>

        <section>
          {isOwner ? (
            <Button
              variant="error"
              icon="delete"
              disabled={!canWrite}
              onClick={() => {
                if (!confirm(t.settings.confirmDelete)) return;
                void mutate(mutators.freezer.delete({ freezerId: freezer.id })).then(
                  (ok) => ok && navigate("/", { replace: true }),
                );
              }}
            >
              {t.settings.deleteFreezer}
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
              {t.settings.leave}
            </Button>
          )}
        </section>

        <VersionInfo />
      </div>
    </div>
  );
}

function RenameFreezer({ freezer, onDone }: { freezer: FreezerDetail; onDone: () => void }) {
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const [name, setName] = useState(freezer.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await mutate(mutators.freezer.rename({ freezerId: freezer.id, name: name.trim() }))) onDone();
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <TextField label={t.setup.name} value={name} autoFocus maxLength={100} leadingIcon="kitchen" onChange={(e) => setName(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="text" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" icon="check" disabled={!name.trim() || name.trim() === freezer.name || !canWrite}>
          {t.common.save}
        </Button>
      </div>
    </form>
  );
}

/** Export (JSON backup, CSV spreadsheet) and import with a preview. */
function DataSection({ freezer, onSwitchFreezer }: { freezer: FreezerDetail; onSwitchFreezer: (id: string) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setParsed(parseImport(await file.text()));
    } catch {
      toast(t.data.invalidFile);
    }
  };

  return (
    <section>
      <SectionTitle icon="download">{t.data.title}</SectionTitle>
      <ListGroup>
        <ListItem
          leading={<Icon name="data_object" className="text-primary" />}
          headline={t.data.exportJson}
          supporting={t.data.exportJsonHint}
          onClick={() => exportFreezer(freezer, "json")}
        />
        <ListItem
          leading={<Icon name="table_view" className="text-primary" />}
          headline={t.data.exportCsv}
          supporting={t.data.exportCsvHint}
          onClick={() => exportFreezer(freezer, "csv")}
        />
        <ListItem
          leading={<Icon name="upload" className="text-primary" />}
          headline={t.data.import}
          supporting={t.data.importHint}
          onClick={() => fileRef.current?.click()}
        />
      </ListGroup>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,.txt,application/json,text/csv"
        hidden
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = ""; // choosing the same file again should work too
        }}
      />
      <ImportSheet
        freezer={freezer}
        parsed={parsed}
        onClose={() => setParsed(null)}
        onNewFreezer={(id) => {
          onSwitchFreezer(id);
          void navigate("/");
        }}
      />
    </section>
  );
}

/** Best-before push notifications for this device; hidden when the server has no VAPID keys. */
function Notifications() {
  const push = usePush();
  const toast = useToast();
  if (push.state === "loading" || push.state === "hidden") return null;
  const on = push.state === "on";
  const supporting =
    push.state === "install" ? t.settings.notificationsInstall : push.state === "blocked" ? t.settings.notificationsBlocked : t.settings.notificationsHint;
  return (
    <section>
      <ListGroup>
        <ListItem
          leading={<Icon name={on ? "notifications" : "notifications_off"} filled={on} className="text-primary" />}
          headline={t.settings.notifications}
          supporting={<span className="whitespace-normal">{supporting}</span>}
          trailing={
            push.state === "on" || push.state === "off" ? (
              <Switch
                checked={on}
                label={t.settings.notifications}
                onChange={(checked) =>
                  void (checked ? push.enable() : push.disable()).then((ok) => ok === false && toast(t.errors.generic))
                }
              />
            ) : undefined
          }
        />
      </ListGroup>
    </section>
  );
}

type Build = typeof __APP_BUILD__;
const formatBuild = (b: Build) => `${b.version} (${b.commit})`;

/** App and server version; a mismatch usually means the service worker still serves an old bundle. */
function VersionInfo() {
  const [server, setServer] = useState<Build | null>();
  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? (res.json() as Promise<Build>) : null))
      .then(setServer, () => setServer(null));
  }, []);
  const mismatch = server && (server.version !== __APP_BUILD__.version || server.commit !== __APP_BUILD__.commit);

  return (
    <footer className="type-body-small flex flex-col items-center gap-1 text-center text-on-surface-variant">
      <span>{t.settings.appVersion(formatBuild(__APP_BUILD__))}</span>
      <span>{t.settings.serverVersion(server ? formatBuild(server) : server === null ? "–" : "…")}</span>
      {mismatch && <span className="text-error">{t.settings.versionMismatch}</span>}
    </footer>
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
        <div className="type-label-large text-on-surface-variant">{t.settings.validUntil(formatDate(expiresAt))}</div>
        <div className="type-body-small truncate font-mono text-on-surface-variant">{url}</div>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Button
            variant="tonal"
            icon={copied ? "check" : "content_copy"}
            onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
          >
            {copied ? t.settings.copied : t.settings.copyLink}
          </Button>
          <Button variant="text" onClick={onRevoke}>
            {t.settings.revoke}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
