import { de } from "@freezer/shared/i18n";
import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Centered } from "../components/AuthedLayout";
import { ItemDialog } from "../components/ItemDialog";
import { ItemSheet } from "../components/ItemSheet";
import { Button, Sheet } from "../components/ui";
import { useFreezerData } from "../lib/freezer-data";

/**
 * Scan target `/c/:number`. If the container holds something in one of my
 * freezers, show it (with "Entnehmen…"); otherwise open "Einfrieren" with the
 * number pre-filled, asking for the freezer first if I have several.
 */
export function ContainerPage() {
  const number = Number(useParams().number);
  const navigate = useNavigate();
  const data = useFreezerData();
  const [occupants, occupantsResult] = useQuery(queries.items.byContainer({ containerNumber: number }));
  const [chosenFreezer, setChosenFreezer] = useState<string | null>(null);
  const close = () => navigate("/", { replace: true });

  const occupant = occupants[0];
  // Show the occupied container in the freezer that holds it.
  useEffect(() => {
    if (occupant && occupant.freezerId !== data.activeId) data.setActiveId(occupant.freezerId);
  }, [occupant, data]);

  if (!Number.isSafeInteger(number) || number <= 0) return <Navigate to="/" replace />;
  if (data.freezersLoaded && data.freezers.length === 0) return <Navigate to="/setup" replace />;
  if (occupantsResult.type !== "complete" && !occupant) return <Centered>{de.common.loading}</Centered>;

  if (occupant) {
    if (!data.freezer || data.freezer.id !== occupant.freezerId) return <Centered>{de.common.loading}</Centered>;
    const item = data.freezer.items.find((i) => i.id === occupant.id);
    if (!item) return <Centered>{de.common.loading}</Centered>;
    return (
      <Centered>
        <ItemSheet freezer={data.freezer} item={item} onClose={close} />
      </Centered>
    );
  }

  const needsChoice = data.freezers.length > 1 && !chosenFreezer;
  if (needsChoice) {
    return (
      <Centered>
        <Sheet title={de.container.title(number)} onClose={close}>
          <p className="mb-3 text-sm text-slate-600">{de.container.chooseFreezer}</p>
          <div className="grid gap-2">
            {data.freezers.map((f) => (
              <Button
                key={f.id}
                variant={f.id === data.activeId ? "primary" : "secondary"}
                onClick={() => {
                  data.setActiveId(f.id);
                  setChosenFreezer(f.id);
                }}
              >
                {f.name}
              </Button>
            ))}
          </div>
        </Sheet>
      </Centered>
    );
  }

  if (!data.freezer) return <Centered>{de.common.loading}</Centered>;
  return (
    <Centered>
      <ItemDialog freezer={data.freezer} containerNumber={number} onClose={close} />
    </Centered>
  );
}
