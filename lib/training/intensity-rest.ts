import type { Block, Prescription, RoutineItemDef } from "@/lib/types";
import {
  applyMinBetweenSetRest,
  MIN_BETWEEN_SET_REST_SECONDS,
} from "@/lib/training/rest";

/**
 * Training intensity bands used to size rest between sets and exercises.
 * Higher bands need longer recovery for quality and nervous-system readiness.
 */
export type IntensityBand = "recovery" | "easy" | "moderate" | "hard" | "max";

const BLOCK_INTENSITY: Partial<Record<Block, IntensityBand>> = {
  warmup: "recovery",
  maintenance: "recovery",
  flexibility: "recovery",
  forearm: "recovery",
  antagonist: "easy",
  core: "easy",
  conditioning: "moderate",
  volume: "moderate",
  legs: "moderate",
  posterior: "moderate",
  lower_leg: "easy",
  stability: "moderate",
  skill: "hard",
  power: "hard",
  strength: "hard",
  speed: "hard",
  agility: "hard",
  run: "moderate",
  swim: "moderate",
  climb: "hard",
};

const SLUG_INTENSITY: Record<string, IntensityBand> = {
  "handstand-push-up": "max",
  "strict-muscle-up": "max",
  "weighted-pull-up": "max",
  "one-leg-human-flag": "hard",
  "front-lever-hold": "hard",
  "back-lever-hold": "hard",
  "planche-hold": "hard",
  "oahs-practice": "hard",
  "nordic-hamstring-curl": "hard",
  "bulgarian-split-squat": "hard",
  "pistol-squat": "hard",
  "single-leg-rdl": "hard",
  "standing-broad-jump": "hard",
  "clap-push-up": "hard",
  "20m-acceleration-sprint": "hard",
  "5-10-5-shuttle": "hard",
  "dragon-flag": "hard",
  "hanging-straight-leg-raise": "moderate",
  "pull-up": "moderate",
  "parallel-bar-dip": "moderate",
  "push-up": "moderate",
  "inverted-row": "moderate",
  burpee: "moderate",
  "mountain-climber": "easy",
};

/** Recommended between-set rest (seconds) by intensity. */
const BETWEEN_SET_REST: Record<IntensityBand, number> = {
  recovery: MIN_BETWEEN_SET_REST_SECONDS,
  easy: 30,
  moderate: 60,
  hard: 90,
  max: 150,
};

/** Recommended transition rest after finishing an exercise, before the next. */
const BETWEEN_EXERCISE_REST: Record<IntensityBand, number> = {
  recovery: 15,
  easy: 20,
  moderate: 30,
  hard: 45,
  max: 60,
};

const BAND_RANK: Record<IntensityBand, number> = {
  recovery: 0,
  easy: 1,
  moderate: 2,
  hard: 3,
  max: 4,
};

function maxBand(a: IntensityBand, b: IntensityBand): IntensityBand {
  return BAND_RANK[a] >= BAND_RANK[b] ? a : b;
}

export function intensityForItem(
  item: Pick<RoutineItemDef, "block" | "exercise_slug" | "prescription">,
): IntensityBand {
  const fromSlug = SLUG_INTENSITY[item.exercise_slug];
  const fromBlock = BLOCK_INTENSITY[item.block] ?? "moderate";
  let band = fromSlug ? maxBand(fromSlug, fromBlock) : fromBlock;

  // Heavier loaded work bumps intensity one step (cap at max).
  const load = item.prescription.load_kg;
  if (load != null && load >= 10 && band !== "max") {
    const next = (Object.keys(BAND_RANK) as IntensityBand[]).find(
      (k) => BAND_RANK[k] === BAND_RANK[band] + 1,
    );
    if (next) band = next;
  }
  return band;
}

export function recommendedBetweenSetRest(
  item: Pick<RoutineItemDef, "block" | "exercise_slug" | "prescription">,
): number {
  return BETWEEN_SET_REST[intensityForItem(item)];
}

export function recommendedBetweenExerciseRest(
  item: Pick<RoutineItemDef, "block" | "exercise_slug" | "prescription">,
): number {
  return BETWEEN_EXERCISE_REST[intensityForItem(item)];
}

function isIntentionalNoRest(item: RoutineItemDef): boolean {
  const notes = `${item.prescription.notes ?? ""}`.toLowerCase();
  if (notes.includes("then ") || notes.includes("superset")) return true;
  if (item.prescription.extras?.circuit_with) return true;
  if (item.block === "warmup" || item.block === "maintenance") return true;
  // Continuous timed work (runs, skill blocks as timed protocols)
  if (
    (item.prescription.sets ?? 1) <= 1 &&
    (item.prescription.rest_seconds ?? item.rest_seconds ?? 0) === 0
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve between-set rest: keep intentional zeros, otherwise use the greater
 * of prescribed rest and intensity-based recommendation (min 15s).
 */
export function resolveIntensityRestSeconds(item: RoutineItemDef): number {
  const prescribed = item.prescription.rest_seconds ?? item.rest_seconds ?? 0;
  if (prescribed === 0 && isIntentionalNoRest(item)) return 0;

  const recommended = recommendedBetweenSetRest(item);
  if (prescribed === 0) {
    return recommended;
  }
  return Math.max(applyMinBetweenSetRest(prescribed), recommended);
}

/**
 * Apply intensity-aware rest onto a prescription snapshot.
 */
export function applyIntensityRestToPrescription(
  item: RoutineItemDef,
  prescription: Prescription,
): Prescription {
  const merged: RoutineItemDef = {
    ...item,
    prescription: {
      ...prescription,
      rest_seconds: prescription.rest_seconds ?? item.rest_seconds,
    },
  };
  return {
    ...prescription,
    rest_seconds: resolveIntensityRestSeconds(merged),
  };
}
