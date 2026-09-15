import type { Block, RoutineItemDef } from "@/lib/types";

const SKILL_SLUG_ORDER = [
  "one-leg-human-flag",
  "planche-hold",
  "oahs-practice",
] as const;

const WARMUP_BLOCKS = new Set<Block>(["warmup", "maintenance"]);

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
 * 1. Warmup / maintenance
 * 2. Skills — flag → planche → OAHS
 * 3. Hard stability (HSPU) → other hard (muscle-up) → remaining work
 *
 * Relative order within each bucket is preserved.
 */
export function normalizeRoutineItemOrder(
  items: RoutineItemDef[],
): RoutineItemDef[] {
  const indexed = items.map((item, index) => ({ item, index }));

  const warmup = indexed.filter((x) => WARMUP_BLOCKS.has(x.item.block));
  const skills = indexed
    .filter((x) => x.item.block === "skill")
    .sort(
      (a, b) =>
        skillRank(a.item.exercise_slug) - skillRank(b.item.exercise_slug) ||
        a.index - b.index,
    );
  const rest = indexed
    .filter(
      (x) => !WARMUP_BLOCKS.has(x.item.block) && x.item.block !== "skill",
    )
    .sort((a, b) => workTier(a.item) - workTier(b.item) || a.index - b.index);

  return [...warmup, ...skills, ...rest].map((x, i) => ({
    ...x.item,
    sequence: i + 1,
  }));
}
