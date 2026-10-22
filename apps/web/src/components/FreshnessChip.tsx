import { freshness, todayAsDate } from "@freezer/shared/domain";
import { bestBeforeLabel } from "../lib/format";
import { Chip } from "./m3";

/** "in 5 days" / "2 weeks over" for items to eat soon; nothing while there's more than a week left. */
export function FreshnessChip({ bestBefore }: { bestBefore: number | null }) {
  const state = freshness(bestBefore, todayAsDate());
  if (state === "ok" || bestBefore === null) return null;
  return (
    <Chip icon="hourglass_bottom" tone={state === "expired" ? "error" : "tertiary"}>
      {bestBeforeLabel(bestBefore)}
    </Chip>
  );
}
