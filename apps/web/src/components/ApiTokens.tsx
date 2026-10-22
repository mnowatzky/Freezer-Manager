import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { formatDate } from "../lib/format";
import { t } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { Button, Icon, IconButton, ListGroup, ListItem, Sheet, TextField } from "./m3";

/** Settings → API tokens: list with "last used" and revoke, create with a copy-once dialog. */
export function ApiTokens({ title }: { title: React.ReactNode }) {
  const [tokens] = useQuery(queries.apiTokens.mine());
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        {title}
        <Button variant="tonal" icon="add" disabled={!canWrite} onClick={() => setCreating(true)}>
          {t.tokens.create}
        </Button>
      </div>
      <p className="type-body-medium mb-3 px-1 text-on-surface-variant">{t.tokens.hint}</p>
      {tokens.length > 0 && (
        <ListGroup>
          <AnimatePresence initial={false}>
            {tokens.map((token) => (
              <ListItem
                key={token.id}
                leading={<Icon name="key" className="text-primary" />}
                headline={token.name}
                supporting={[
                  token.scope === "write" ? t.tokens.write : t.tokens.read,
                  `${token.prefix}…`,
                  token.lastUsedAt ? t.tokens.lastUsed(formatDate(token.lastUsedAt)) : t.tokens.neverUsed,
                ].join(" · ")}
                trailing={
                  <IconButton
                    icon="key_off"
                    label={t.tokens.revoke}
                    disabled={!canWrite}
                    onClick={() => void mutate(mutators.apiToken.revoke({ id: token.id }))}
                  />
                }
              />
            ))}
          </AnimatePresence>
        </ListGroup>
      )}
      <Sheet open={creating} title={t.tokens.create} onClose={() => setCreating(false)}>
        <CreateToken onDone={() => setCreating(false)} />
      </Sheet>
    </section>
  );
}

function CreateToken({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      if (res.status === 409) toast(t.tokens.tooMany);
      else if (!res.ok) toast(t.errors.generic);
      else setToken(((await res.json()) as { token: string }).token);
    } catch {
      toast(t.errors.network);
    } finally {
      setBusy(false);
    }
  };

  if (token)
    return (
      <div className="flex flex-col gap-4">
        <p className="type-body-medium flex items-start gap-3 rounded-l bg-tertiary-container px-4 py-3 text-on-tertiary-container">
          <Icon name="warning" />
          {t.tokens.copyOnce}
        </p>
        <code className="type-body-medium block rounded-l bg-surface-container px-4 py-3 font-mono break-all select-all">{token}</code>
        <p className="type-body-small px-1 text-on-surface-variant">{t.tokens.baseUrl(`${location.origin}/api/v1`)}</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onDone}>
            {t.common.close}
          </Button>
          <Button
            icon={copied ? "check" : "content_copy"}
            onClick={() => void navigator.clipboard.writeText(token).then(() => setCopied(true))}
          >
            {copied ? t.settings.copied : t.tokens.copy}
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={(e) => void create(e)} className="flex flex-col gap-4">
      <TextField label={t.tokens.name} placeholder={t.tokens.namePlaceholder} value={name} autoFocus maxLength={100} onChange={(e) => setName(e.target.value)} />
      <fieldset className="flex flex-col gap-1">
        {(["read", "write"] as const).map((value) => (
          <label key={value} className="type-body-large flex cursor-pointer items-center gap-3 py-1">
            <input type="radio" name="token-scope" className="size-5 accent-primary" checked={scope === value} onChange={() => setScope(value)} />
            {value === "read" ? t.tokens.read : t.tokens.write}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="text" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" icon="key" disabled={!name.trim() || busy}>
          {t.tokens.create}
        </Button>
      </div>
    </form>
  );
}
