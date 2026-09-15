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

function totalMinutesFromItems(
  items: {
    seconds: number;
    betweenExerciseRest: number;
  }[],
): number {
  if (items.length === 0) return 0;
  let totalSec = 0;
  for (let i = 0; i < items.length; i++) {
    totalSec += items[i]!.seconds;
    if (i < items.length - 1) totalSec += items[i]!.betweenExerciseRest;
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
  return totalMinutesFromItems(
    items.map((item) => ({
      seconds: estimateItemDurationSeconds(item),
      betweenExerciseRest: recommendedBetweenExerciseRest(item),
    })),
  );
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
  return totalMinutesFromItems(
    sorted.map((item) => ({
      seconds: estimateFromPrescription(
        item.prescription_snapshot,
        item.exercise_slug,
      ),
      betweenExerciseRest: recommendedBetweenExerciseRest({
        block: item.block,
        exercise_slug: item.exercise_slug,
        prescription: item.prescription_snapshot,
      }),
    })),
  );
}
