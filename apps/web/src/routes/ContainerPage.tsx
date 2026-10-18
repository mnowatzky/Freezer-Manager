import { t } from "../lib/i18n";
import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { FullScreenLoading } from "../components/AuthedLayout";
import { ItemDialog } from "../components/ItemDialog";
import { ItemSheet } from "../components/ItemSheet";
import { Icon, ListGroup, ListItem, Sheet } from "../components/m3";
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
  const close = () => void navigate("/", { replace: true });

  const occupant = occupants[0];
  // Show the occupied container in the freezer that holds it.
  useEffect(() => {
    if (occupant && occupant.freezerId !== data.activeId) data.setActiveId(occupant.freezerId);
  }, [occupant, data]);

  if (!Number.isSafeInteger(number) || number <= 0) return <Navigate to="/" replace />;
  if (data.freezersLoaded && data.freezers.length === 0) return <Navigate to="/setup" replace />;
  if (occupantsResult.type !== "complete" && !occupant) return <FullScreenLoading />;

  if (occupant) {
    const item = data.freezer?.id === occupant.freezerId ? data.freezer.items.find((i) => i.id === occupant.id) : undefined;
    if (!data.freezer || !item) return <FullScreenLoading />;
    return (
      <>
        <FullScreenLoading />
        <ItemSheet freezer={data.freezer} item={item} onClose={close} />
      </>
    );
  }

  if (data.freezers.length > 1 && !chosenFreezer) {
    return (
      <Sheet open title={t.container.title(number)} onClose={close}>
        <p className="type-body-medium mb-4 text-on-surface-variant">{t.container.chooseFreezer}</p>
        <ListGroup>
          {data.freezers.map((f) => (
            <ListItem
              key={f.id}
              headline={f.name}
              leading={<Icon name="kitchen" filled={f.id === data.activeId} className="text-primary" />}
              onClick={() => {
                data.setActiveId(f.id);
                setChosenFreezer(f.id);
              }}
            />
          ))}
        </ListGroup>
      </Sheet>
    );
  }

  if (!data.freezer) return <FullScreenLoading />;
  return <ItemDialog open freezer={data.freezer} containerNumber={number} onClose={close} />;
}
