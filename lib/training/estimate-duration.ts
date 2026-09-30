import type {
  Prescription,
  RoutineItemDef,
  RoutineTemplateDef,
  SessionItem,
} from "@/lib/types";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { recommendedBetweenExerciseRest } from "@/lib/training/intensity-rest";
import { applyMinBetweenSetRest } from "@/lib/training/rest";

/** Seconds to complete one bodyweight rep. */
const SEC_PER_REP = 3;
/** Weighted / explosive reps (setup + tempo). */
const SEC_PER_LOADED_REP = 4;
/** Swim pace for distance prescriptions (sec/m). */
const SEC_PER_SWIM_M = 1.4;
/** Land sprint / shuttle (sec/m). */
const SEC_PER_LAND_SPRINT_M = 0.2;
/** Untimed climbing attempt. */
const SEC_PER_CLIMB_ATTEMPT = 45;

function sides(p: Prescription): number {
  return p.per_side ? 2 : 1;
}

function setCount(p: Prescription): number {
  return Math.max(1, p.sets ?? 1);
}

function restBetweenSets(p: Prescription): number {
  const rest = applyMinBetweenSetRest(p.rest_seconds ?? 0);
  const n = setCount(p);
  if (n <= 1 || rest <= 0) return 0;
  return (n - 1) * rest;
}

function workSecondsPerSet(p: Prescription, metricType: string): number {
  if (p.duration_seconds != null && p.duration_seconds > 0) {
    if (!p.sets || metricType === "skill_block") {
      return p.duration_seconds;
    }
    return p.duration_seconds * sides(p);
  }
  if (p.hold_seconds != null && p.hold_seconds > 0) {
    return p.hold_seconds * sides(p);
  }
  if (p.reps_per_set != null && p.reps_per_set > 0) {
    const perRep =
      metricType === "load_reps" || (p.load_kg != null && p.load_kg > 0)
        ? SEC_PER_LOADED_REP
        : SEC_PER_REP;
    return p.reps_per_set * perRep * sides(p);
  }
  if (p.distance_m != null && p.distance_m > 0) {
    if (metricType === "swim") {
      return p.distance_m * SEC_PER_SWIM_M * sides(p);
    }
    return Math.max(8, p.distance_m * SEC_PER_LAND_SPRINT_M) * sides(p);
  }
  if (metricType === "climb") {
    return SEC_PER_CLIMB_ATTEMPT * sides(p);
  }
  return 30 * sides(p);
}

function estimateFromPrescription(
  prescription: Prescription,
  exerciseSlug: string,
  fallbackRest = 0,
): number {
  const p: Prescription = {
    ...prescription,
    rest_seconds: applyMinBetweenSetRest(
      prescription.rest_seconds ?? fallbackRest,
    ),
  };

  const ex = getExerciseBySlug(exerciseSlug);
  const metric = ex?.metric_type ?? "reps";

  if (metric === "skill_block") {
    return p.duration_seconds ?? 300;
  }

  const work = workSecondsPerSet(p, metric) * setCount(p);
  const betweenSetRest = restBetweenSets(p);
  const trailing =
    setCount(p) === 1 && (p.rest_seconds ?? 0) > 0 ? (p.rest_seconds ?? 0) : 0;

  return work + betweenSetRest + trailing;
}

/**
 * Estimate seconds for one routine item: set work + between-set rest.
 */
export function estimateItemDurationSeconds(item: RoutineItemDef): number {
  return estimateFromPrescription(
    item.prescription,
    item.exercise_slug,
    item.rest_seconds,
  );
}

function transitionEstimateSeconds(
  current: Pick<RoutineItemDef, "block" | "exercise_slug" | "prescription">,
  next: Pick<RoutineItemDef, "block" | "exercise_slug" | "prescription">,
): number {
  const currentCircuit = current.prescription.extras?.circuit_id;
  const nextCircuit = next.prescription.extras?.circuit_id;
  if (
    typeof currentCircuit === "string" &&
    currentCircuit === nextCircuit
  ) {
    return 0;
  }
  const roundRest = current.prescription.extras?.round_rest_seconds;
  if (typeof roundRest === "number" && roundRest > 0) {
    return roundRest;
  }
  return recommendedBetweenExerciseRest(current);
}

function totalMinutesFromRoutineItems(
  items: RoutineItemDef[],
): number {
  if (items.length === 0) return 0;
  let totalSec = 0;
  for (let i = 0; i < items.length; i++) {
    const current = items[i]!;
    totalSec += estimateItemDurationSeconds(current);
    if (i < items.length - 1) {
      totalSec += transitionEstimateSeconds(current, items[i + 1]!);
    }
  }
  return Math.max(1, Math.round(totalSec / 60));
}

/**
 * Estimate total workout duration in minutes from set work + rest times.
 */
export function estimateRoutineDurationMin(
  routine: Pick<RoutineTemplateDef, "items">,
): number {
  const items = routine.items.slice().sort((a, b) => a.sequence - b.sequence);
  return totalMinutesFromRoutineItems(items);
}

/**
 * Estimate duration from a live session snapshot (includes progression loads).
 */
export function estimateSessionDurationMin(
  items: Pick<
    SessionItem,
    "sequence" | "exercise_slug" | "block" | "prescription_snapshot"
  >[],
): number {
  const sorted = items.slice().sort((a, b) => a.sequence - b.sequence);
  if (sorted.length === 0) return 0;
  let totalSec = 0;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    totalSec += estimateFromPrescription(
      current.prescription_snapshot,
      current.exercise_slug,
    );
    if (i < sorted.length - 1) {
      totalSec += transitionEstimateSeconds(
        {
          block: current.block,
          exercise_slug: current.exercise_slug,
          prescription: current.prescription_snapshot,
        },
        {
          block: sorted[i + 1]!.block,
          exercise_slug: sorted[i + 1]!.exercise_slug,
          prescription: sorted[i + 1]!.prescription_snapshot,
        },
      );
    }
  }
  return Math.max(1, Math.round(totalSec / 60));
}
