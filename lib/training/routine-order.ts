import type { Block, RoutineItemDef } from "@/lib/types";

const SKILL_SLUG_ORDER = [
  "oahs-practice",
  "planche-hold",
  "one-leg-human-flag",
  "front-lever-hold",
  "back-lever-hold",
] as const;

const WARMUP_BLOCKS = new Set<Block>(["warmup", "maintenance"]);

const POST_SKILL_WARMUP_SLUGS = new Set([
  "easy-jog",
  "leg-swings-front-back",
  "leg-swings-lateral",
  "walking-lunge",
  "ankle-pogo-hop",
  "high-knees",
  "butt-kicks",
  "air-squat",
  "bodyweight-squat",
  "reverse-lunge",
]);

function skillRank(slug: string): number {
  const idx = SKILL_SLUG_ORDER.indexOf(
    slug as (typeof SKILL_SLUG_ORDER)[number],
  );
  return idx === -1 ? 99 : idx;
}

function workTier(item: RoutineItemDef): number {
  if (item.exercise_slug === "handstand-push-up") return 0;
  if (item.exercise_slug === "strict-muscle-up") return 1;
  return 2;
}

/**
 * Session order:
 * 1. Wrist / shoulder / upper-body preparation
 * 2. Skills — OAHS → planche → human flag → front lever → back lever
 * 3. Lower-body / cardio warm-up
 * 4. Main strength, power, endurance and flexibility work
 */
export function normalizeRoutineItemOrder(
  items: RoutineItemDef[],
): RoutineItemDef[] {
  const indexed = items.map((item, index) => ({ item, index }));

  const preSkillWarmup = indexed.filter(
    (x) =>
      WARMUP_BLOCKS.has(x.item.block) &&
      !POST_SKILL_WARMUP_SLUGS.has(x.item.exercise_slug),
  );
  const skills = indexed
    .filter((x) => x.item.block === "skill")
    .sort(
      (a, b) =>
        skillRank(a.item.exercise_slug) - skillRank(b.item.exercise_slug) ||
        a.index - b.index,
    );
  const postSkillWarmup = indexed.filter(
    (x) =>
      WARMUP_BLOCKS.has(x.item.block) &&
      POST_SKILL_WARMUP_SLUGS.has(x.item.exercise_slug),
  );
  const rest = indexed
    .filter(
      (x) => !WARMUP_BLOCKS.has(x.item.block) && x.item.block !== "skill",
    )
    .sort((a, b) => workTier(a.item) - workTier(b.item) || a.index - b.index);

  return [...preSkillWarmup, ...skills, ...postSkillWarmup, ...rest].map(
    (x, i) => ({
      ...x.item,
      sequence: i + 1,
    }),
  );
}
