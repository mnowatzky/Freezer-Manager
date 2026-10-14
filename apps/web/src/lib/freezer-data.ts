import { queries } from "@freezer/shared/queries";
import { useQuery } from "@rocicorp/zero/react";
import { useActiveFreezer } from "./active-freezer";

/** The user's freezers plus the full detail of the active one, live-synced. */
export function useFreezerData() {
  const [freezers, freezersResult] = useQuery(queries.freezers.mine(), { ttl: "5m" });
  const [activeId, setActiveId] = useActiveFreezer(freezers.map((f) => f.id));
  const [detail, detailResult] = useQuery(activeId ? queries.freezers.detail({ freezerId: activeId }) : null, {
    ttl: "5m",
  });
  return {
    freezers,
    freezersLoaded: freezersResult.type === "complete",
    activeId,
    setActiveId,
    freezer: detail,
    detailLoaded: !activeId || detailResult?.type === "complete",
  };
}

export type FreezerDetail = NonNullable<ReturnType<typeof useFreezerData>["freezer"]>;
export type ItemRow = FreezerDetail["items"][number];
