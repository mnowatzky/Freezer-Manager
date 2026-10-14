import { MAX_DRAWERS } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Field, inputClass, PageHeader } from "../components/ui";
import { mutators, useCanWrite, useMutate } from "../lib/zero";

const ACTIVE_KEY = "activeFreezerId";

export function SetupPage() {
  const navigate = useNavigate();
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const [name, setName] = useState("");
  const [drawerCount, setDrawerCount] = useState(5);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = crypto.randomUUID();
    const drawerIds = Array.from({ length: drawerCount }, () => crypto.randomUUID());
    if (await mutate(mutators.freezer.create({ id, name: name.trim(), drawerIds }))) {
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        // ignore
      }
      navigate("/", { replace: true });
    }
  };

  return (
    <>
      <PageHeader title={de.setup.title} />
      <form onSubmit={submit} className="mx-auto max-w-md space-y-4 p-4">
        <Field label={de.setup.name}>
          <input
            className={inputClass}
            value={name}
            autoFocus
            placeholder={de.setup.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={de.setup.drawerCount}>
          <input
            type="number"
            className={inputClass}
            min={1}
            max={MAX_DRAWERS}
            value={drawerCount}
            onChange={(e) => setDrawerCount(Math.min(MAX_DRAWERS, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={!name.trim() || !canWrite}>
          {de.setup.create}
        </Button>
      </form>
    </>
  );
}
