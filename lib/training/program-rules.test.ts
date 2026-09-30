import { describe, expect, it } from "vitest";
import { getRoutineById, ROUTINES } from "@/lib/seed/routines";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import { addDays } from "@/lib/utils";
import type { ScheduledSession } from "@/lib/types";

const START = "2026-09-14";

function setup(weeksAhead = 8) {
  const cycle = createActiveCycle("user-1", START);
  const sessions = generateScheduledSessions({
    userId: "user-1",
    cycle,
    weeksAhead,
  });
  return { cycle, sessions };
}

function activeOn(
  sessions: ScheduledSession[],
  date: string,
): ScheduledSession[] {
  return sessions.filter(
    (session) =>
      session.date === date &&
      [
        "scheduled",
        "in_progress",
        "completed",
        "partially_completed",
      ].includes(session.status),
  );
}

function routineSlugs(session: ScheduledSession): string[] {
  return (
    getRoutineById(session.routine_template_id)?.items.map(
      (item) => item.exercise_slug,
    ) ?? []
  );
}

function slugsOn(
  sessions: ScheduledSession[],
  date: string,
): string[] {
  return activeOn(sessions, date).flatMap(routineSlugs);
}

function datesInWeek(weekIndex: number): string[] {
  return Array.from({ length: 7 }, (_, day) =>
    addDays(START, weekIndex * 7 + day),
  );
}

function exposureCount(
  sessions: ScheduledSession[],
  weekIndex: number,
  predicate: (slugs: string[]) => boolean,
): number {
  return datesInWeek(weekIndex).filter((date) =>
    predicate(slugsOn(sessions, date)),
  ).length;
}

describe("programme invariants", () => {
  it("provides light wrist/scapular + OAHS + planche coverage every day", () => {
    const { sessions } = setup(4);

    for (let offset = 0; offset < 28; offset += 1) {
      const date = addDays(START, offset);
      const slugs = slugsOn(sessions, date);

      expect(slugs, date).toContain("oahs-practice");
      expect(slugs, date).toContain("planche-hold");
      expect(
        slugs.includes("wrist-rocks") ||
          slugs.includes("wrist-circles"),
        date,
      ).toBe(true);
      expect(slugs, date).toContain("scapular-push-up");
      expect(slugs, date).toContain("scapular-pull-up");
    }
  });

  it("meets the requested weekly strength and advanced-skill frequency floors", () => {
    const { sessions } = setup(4);

    for (let week = 0; week < 4; week += 1) {
      expect(
        exposureCount(
          sessions,
          week,
          (slugs) => slugs.includes("handstand-push-up"),
        ),
        `week ${week + 1} HSPU`,
      ).toBeGreaterThanOrEqual(2);

      expect(
        exposureCount(
          sessions,
          week,
          (slugs) =>
            slugs.includes("parallel-bar-dip") ||
            slugs.includes("ring-dip"),
        ),
        `week ${week + 1} dips`,
      ).toBeGreaterThanOrEqual(2);

      expect(
        exposureCount(
          sessions,
          week,
          (slugs) => slugs.includes("strict-muscle-up"),
        ),
        `week ${week + 1} muscle-up`,
      ).toBeGreaterThanOrEqual(1);

      expect(
        exposureCount(
          sessions,
          week,
          (slugs) => slugs.includes("iron-cross-hold"),
        ),
        `week ${week + 1} Iron Cross`,
      ).toBeGreaterThanOrEqual(3);

      for (const slug of [
        "one-leg-human-flag",
        "front-lever-hold",
        "back-lever-hold",
      ]) {
        expect(
          exposureCount(
            sessions,
            week,
            (slugs) => slugs.includes(slug),
          ),
          `week ${week + 1} ${slug}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("always orders Iron Cross after planche and before flag/levers", () => {
    for (const routine of ROUTINES) {
      const slugs = routine.items.map((item) => item.exercise_slug);
      const iron = slugs.indexOf("iron-cross-hold");
      if (iron < 0) continue;

      const planche = slugs.indexOf("planche-hold");
      expect(planche, routine.id).toBeGreaterThanOrEqual(0);
      expect(planche, routine.id).toBeLessThan(iron);

      for (const advanced of [
        "one-leg-human-flag",
        "front-lever-hold",
        "back-lever-hold",
      ]) {
        const index = slugs.indexOf(advanced);
        if (index >= 0) expect(iron, routine.id).toBeLessThan(index);
      }
    }
  });

  it("removes the retired running warm-up drills from all live routines", () => {
    const retired = new Set([
      "easy-jog",
      "walking-lunge",
      "high-knees",
      "butt-kicks",
    ]);

    for (const routine of ROUTINES) {
      for (const item of routine.items) {
        expect(
          retired.has(item.exercise_slug),
          `${routine.id}: ${item.exercise_slug}`,
        ).toBe(false);
      }
    }
  });

  it("uses two Rings sessions per 4-week block and varies Circuit/Murph work capacity", () => {
    const { sessions } = setup(8);
    const baseSessions = sessions.filter(
      (session) =>
        session.status === "scheduled" &&
        session.day_role !== "daily_skill_practice",
    );

    const countRole = (
      fromOffset: number,
      throughOffset: number,
      role: ScheduledSession["day_role"],
    ) =>
      baseSessions.filter(
        (session) =>
          session.date >= addDays(START, fromOffset) &&
          session.date <= addDays(START, throughOffset) &&
          session.day_role === role,
      ).length;

    expect(countRole(0, 27, "rings_workout")).toBe(2);
    expect(countRole(28, 55, "rings_workout")).toBe(2);

    expect(countRole(0, 27, "circuit_workout")).toBe(2);
    expect(countRole(0, 27, "murph")).toBe(0);

    expect(countRole(28, 55, "circuit_workout")).toBe(1);
    expect(countRole(28, 55, "murph")).toBe(1);
  });

  it("keeps the screenshot-derived Rings movements and scalable ring positions", () => {
    const rings = getRoutineById("routine-rings")!;
    const slugs = rings.items.map((item) => item.exercise_slug);

    for (const slug of [
      "iron-cross-hold",
      "ring-pull-up",
      "ring-dip",
      "ring-row",
      "ring-push-up",
      "ring-y-t",
      "ring-biceps-curl",
      "ring-triceps-extension",
    ]) {
      expect(slugs).toContain(slug);
    }

    for (const slug of [
      "ring-row",
      "ring-push-up",
      "ring-y-t",
      "ring-biceps-curl",
      "ring-triceps-extension",
    ]) {
      expect(
        rings.items.find((item) => item.exercise_slug === slug)
          ?.prescription.exercise_level,
      ).toBeTruthy();
    }
  });

  it("defines Murph as 1.6 km + 20 partitioned 5/10/15 rounds + 1.6 km", () => {
    const murph = getRoutineById("routine-murph")!;
    const runs = murph.items.filter(
      (item) => item.exercise_slug === "murph-run",
    );
    const rounds = murph.items.find(
      (item) => item.exercise_slug === "murph-round",
    )!;

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.prescription.distance_m)).toEqual([
      1600,
      1600,
    ]);
    expect(rounds.prescription.sets).toBe(20);
    expect(rounds.prescription.extras).toMatchObject({
      pullups: 5,
      pushups: 10,
      squats: 15,
      vest_kg: 0,
    });
  });

  it("has both skill-inclusive and exercise-only Gym replacement variants", () => {
    const plain = getRoutineById("routine-gym-replacement")!;
    const withSkills = getRoutineById(
      "routine-gym-replacement-skills",
    )!;

    const plainSlugs = plain.items.map((item) => item.exercise_slug);
    const skillSlugs = withSkills.items.map(
      (item) => item.exercise_slug,
    );

    expect(plainSlugs).not.toContain("oahs-practice");
    expect(plainSlugs).not.toContain("planche-hold");
    expect(skillSlugs).toContain("wrist-rocks");
    expect(skillSlugs).toContain("scapular-push-up");
    expect(skillSlugs).toContain("scapular-pull-up");
    expect(skillSlugs).toContain("oahs-practice");
    expect(skillSlugs).toContain("planche-hold");
    expect(skillSlugs).not.toContain("iron-cross-hold");
  });
});
