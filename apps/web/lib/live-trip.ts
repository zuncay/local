// Live trip progress, shared by the "on the way" card and the payment moment.
// A paid stop is done once its money has moved (paid to the venue or refunded);
// any stop is also done once the traveller reached it and moved on, or skipped it.
// Arrivals and skips are kept on this device only.
import type { ItineraryView, StopView } from "./types";

/** Within this distance of a stop counts as being there (metres). */
export const ARRIVE_M = 80;
/** Leaving a reached stop by this much moves on to the next one (metres). */
export const LEAVE_M = 250;

const key = (itId: string) => `toura.live.${itId}`;

/** Stop ids reached ("seen") and finished on this device ("done"). */
export type LocalProgress = { seen: string[]; done: string[] };

export function readProgress(itId: string): LocalProgress {
  try {
    const v = JSON.parse(localStorage.getItem(key(itId)) ?? "null") as LocalProgress | null;
    return { seen: v?.seen ?? [], done: v?.done ?? [] };
  } catch {
    return { seen: [], done: [] };
  }
}

export function writeProgress(itId: string, p: LocalProgress) {
  try {
    localStorage.setItem(key(itId), JSON.stringify(p));
  } catch {
    /* private mode: progress lasts for this visit only */
  }
}

const settled = (s: StopView) => s.status === "RELEASED" || s.status === "REFUNDED";

/**
 * Which stops are behind the traveller, and the one they are heading to.
 * A stop before a finished one counts as passed (they went on without it).
 */
export function tripProgress(it: ItineraryView, local: LocalProgress) {
  const isDone = (s: StopView) => settled(s) || local.done.includes(s.id);
  let last = -1;
  it.stops.forEach((s, i) => {
    if (isDone(s)) last = i;
  });
  const doneIds = it.stops.filter((s, i) => i <= last || isDone(s)).map((s) => s.id);
  const target = it.stops.find((s, i) => i > last && !isDone(s)) ?? null;
  return { doneIds, done: doneIds.length, total: it.stops.length, target };
}
