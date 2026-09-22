import type { Prescription, RoutineItemDef } from "@/lib/types";
import { clone } from "@/lib/utils";

/** Week 4 deload transforms (§6.12) */
export function applyDeloadToPrescription(
  item: RoutineItemDef,
  prescription: Prescription,
  cycleWeek: 1 | 2 | 3 | 4,
): Prescription {
  if (cycleWeek !== 4) return prescription;
  const p = clone(prescription);

  // OAHS remains full
  if (item.exercise_slug === "oahs-practice") return p;

  // The daily primer is already a deliberately light technique exposure.
  if (
    item.exercise_slug === "planche-hold" &&
    prescription.extras?.daily_primer === true
  ) {
    return p;
  }

  // Planche uses light protocol on every scheduled planche day in deload
  if (item.exercise_slug === "planche-hold") {
    p.protocol = "light";
    p.notes = "Deload: light planche protocol";
    p.extras = {
      lean: "4 x 15 sec",
      holds: "2 x 6 sec",
      leanRest: 30,
      holdRest: 45,
    };
    return p;
  }

  // Human flag becomes 2 sets
  if (item.exercise_slug === "one-leg-human-flag" && p.sets) {
    p.sets = 2;
  }

  // Saturday conditioning becomes 2 rounds
  if (
    (item.exercise_slug === "burpee" ||
      item.exercise_slug === "mountain-climber") &&
    p.sets
  ) {
    p.sets = 2;
  }

  // Generic set reduction: 4→3, 3→2
  if (p.sets === 4) p.sets = 3;
  else if (p.sets === 3) p.sets = 2;

  if (item.block === "flexibility" || item.exercise_slug.includes("split")) {
    p.notes = [p.notes, "Deload intensity target 5/10 — do not chase max depth"]
      .filter(Boolean)
      .join(". ");
  }

  return p;
}

export function resolvePlancheHolds(
  protocol: "hard" | "medium" | "light",
  state: Record<string, unknown>,
): { lean: string; holds: string; holdSec: number; sets: number } {
  const hard = Number(state.hard_hold_seconds ?? 8);
  const medium = Number(state.medium_hold_seconds ?? 6);
  const light = Number(state.light_hold_seconds ?? 6);
  if (protocol === "hard") {
    return {
      lean: "2 x 20 sec",
      holds: `5 x ${hard} sec`,
      holdSec: hard,
      sets: 5,
    };
  }
  if (protocol === "medium") {
    return {
      lean: "2 x 15 sec",
      holds: `4 x ${medium} sec`,
      holdSec: medium,
      sets: 4,
    };
  }
  return {
    lean: "4 x 15 sec",
    holds: `2 x ${light} sec`,
    holdSec: light,
    sets: 2,
  };
}
