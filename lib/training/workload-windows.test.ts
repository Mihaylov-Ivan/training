import { describe, expect, it } from "vitest";
import { getRoutineById } from "@/lib/seed/routines";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import {
  calculateWorkloadWindows,
  type WorkloadQuality,
} from "@/lib/training/workload-windows";
import { addDays } from "@/lib/utils";
import type { Block, ScheduledSession } from "@/lib/types";

const START = "2026-09-01";
const NOMINAL_END = addDays(START, 27);

function setup() {
  const cycle = createActiveCycle("user-1", START);
  const sessions = generateScheduledSessions({
    userId: "user-1",
    cycle,
    weeksAhead: 12,
  });
  return { cycle, sessions };
}

function hasAnyBlock(
  session: ScheduledSession,
  blocks: Block[],
): boolean {
  const routine = getRoutineById(session.routine_template_id);
  return (
    routine?.items.some((item) => blocks.includes(item.block)) ?? false
  );
}

function markCompleted(
  session: ScheduledSession,
): ScheduledSession {
  return {
    ...session,
    status: "completed",
    completed_at: `${session.date}T12:00:00.000Z`,
  };
}

function windowFor(
  quality: WorkloadQuality,
  sessions: ScheduledSession[],
  cycle: ReturnType<typeof createActiveCycle>,
  today: string,
) {
  return calculateWorkloadWindows({
    cycle,
    sessions,
    today,
  }).find((window) => window.quality === quality)!;
}

describe("adaptive workload windows", () => {
  it("does not extend explosiveness when the required 28-day workload is completed", () => {
    const { cycle, sessions } = setup();
    const updated = sessions.map((session) =>
      session.date >= START &&
      session.date <= NOMINAL_END &&
      hasAnyBlock(session, ["power", "speed", "agility"])
        ? markCompleted(session)
        : session,
    );

    const window = windowFor(
      "explosiveness",
      updated,
      cycle,
      NOMINAL_END,
    );

    expect(window.target_exposures).toBeGreaterThan(0);
    expect(window.completed_exposures).toBe(window.target_exposures);
    expect(window.extension_triggered).toBe(false);
    expect(window.extension_days).toBe(0);
  });

  it("extends explosiveness after enough monthly exposure is lost", () => {
    const { cycle, sessions } = setup();
    const baseRows = sessions.filter(
      (session) =>
        session.date >= START &&
        session.date <= NOMINAL_END &&
        hasAnyBlock(session, ["power", "speed", "agility"]),
    );
    const lostCount = Math.max(
      1,
      Math.ceil(baseRows.length * 0.2),
    );
    const lostIds = new Set(
      baseRows.slice(0, lostCount).map((row) => row.id),
    );

    const updated = sessions.map((session) => {
      if (!baseRows.some((row) => row.id === session.id)) {
        return session;
      }
      if (lostIds.has(session.id)) {
        return {
          ...session,
          status: "missed" as const,
        };
      }
      return markCompleted(session);
    });

    const window = windowFor(
      "explosiveness",
      updated,
      cycle,
      NOMINAL_END,
    );

    expect(window.extension_triggered).toBe(true);
    expect(window.remaining_exposures).toBe(lostCount);
    expect(window.extension_days).toBeGreaterThan(0);
    expect(window.effective_end > window.nominal_end).toBe(true);
  });

  it("keeps the extended window open until later normal sessions repay the lost exposure", () => {
    const { cycle, sessions } = setup();
    const baseRows = sessions.filter(
      (session) =>
        session.date >= START &&
        session.date <= NOMINAL_END &&
        hasAnyBlock(session, ["power", "speed", "agility"]),
    );
    const lostCount = Math.max(
      1,
      Math.ceil(baseRows.length * 0.2),
    );
    const lostIds = new Set(
      baseRows.slice(0, lostCount).map((row) => row.id),
    );
    const futureRows = sessions
      .filter(
        (session) =>
          session.date > NOMINAL_END &&
          hasAnyBlock(session, ["power", "speed", "agility"]),
      )
      .slice(0, lostCount);
    const futureIds = new Set(futureRows.map((row) => row.id));

    const updated = sessions.map((session) => {
      if (lostIds.has(session.id)) {
        return { ...session, status: "missed" as const };
      }
      if (
        baseRows.some((row) => row.id === session.id) ||
        futureIds.has(session.id)
      ) {
        return markCompleted(session);
      }
      return session;
    });

    const lastRepaymentDate =
      futureRows[futureRows.length - 1]!.date;
    const window = windowFor(
      "explosiveness",
      updated,
      cycle,
      lastRepaymentDate,
    );

    expect(window.extension_triggered).toBe(true);
    expect(window.remaining_exposures).toBe(0);
    expect(window.completed_exposures).toBe(window.target_exposures);
    expect(window.effective_end).toBe(lastRepaymentDate);
  });

  it("extends a low-frequency climbing window when its required exposure is missed", () => {
    const { cycle, sessions } = setup();
    const climbingRows = sessions.filter(
      (session) =>
        session.date >= START &&
        session.date <= NOMINAL_END &&
        hasAnyBlock(session, ["climb"]),
    );
    expect(climbingRows.length).toBeGreaterThan(0);

    const updated = sessions.map((session) =>
      climbingRows.some((row) => row.id === session.id)
        ? { ...session, status: "missed" as const }
        : session,
    );

    const window = windowFor(
      "climbing",
      updated,
      cycle,
      NOMINAL_END,
    );

    expect(window.extension_triggered).toBe(true);
    expect(window.remaining_exposures).toBe(
      window.target_exposures,
    );
    expect(window.effective_end > window.nominal_end).toBe(true);
  });
});
