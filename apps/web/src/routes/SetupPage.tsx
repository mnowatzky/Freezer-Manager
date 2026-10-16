import { MAX_DRAWERS } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton, TextField, TopAppBar } from "../components/m3";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { motionScheme } from "../theme/motion";

const ACTIVE_KEY = "activeFreezerId";

export function SetupPage() {
  const navigate = useNavigate();
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const [name, setName] = useState("");
  const [drawerCount, setDrawerCount] = useState(5);
  const change = (d: number) => setDrawerCount((n) => Math.min(MAX_DRAWERS, Math.max(1, n + d)));

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
      void navigate("/", { replace: true });
    }
  };

  return (
    <div className="min-h-dvh">
      <TopAppBar title={de.setup.title} navigation={<IconButton icon="arrow_back" label={de.common.back} onClick={() => void navigate(-1)} />} />
      <form onSubmit={(e) => void submit(e)} className="mx-auto flex max-w-md flex-col gap-6 px-4">
        <TextField label={de.setup.name} value={name} autoFocus leadingIcon="kitchen" supporting={de.setup.namePlaceholder} onChange={(e) => setName(e.target.value)} />

        <div>
          <div className="type-title-medium mb-3">{de.setup.drawerCount}</div>
          <div className="flex items-center gap-4">
            <IconButton icon="remove" label={de.common.less} variant="tonal" size={48} onClick={() => change(-1)} />
            <div className="type-display-small type-emphasized w-12 text-center">{drawerCount}</div>
            <IconButton icon="add" label={de.common.more} variant="tonal" size={48} onClick={() => change(1)} />
          </div>
          {/* Preview of the drawers as stacked tiles that spring in/out. */}
          <div className="mt-5 flex flex-col gap-0.5">
            <AnimatePresence initial={false}>
              {Array.from({ length: drawerCount }, (_, i) => (
                <motion.div
                  key={i}
                  layout
                  className="type-label-large flex h-9 items-center overflow-hidden rounded-xs bg-surface-container-high px-4 text-on-surface-variant first:rounded-t-l last:rounded-b-l"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 36 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={motionScheme.defaultSpatial}
                >
                  {de.drawerName(i + 1)}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <Button type="submit" size="m" icon="check" className="w-full" disabled={!name.trim() || !canWrite}>
          {de.setup.create}
        </Button>
      </form>
    </div>
  );
}
