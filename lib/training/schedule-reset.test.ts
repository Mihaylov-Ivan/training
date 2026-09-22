import { describe, expect, it } from "vitest";
import { buildFutureScheduleReset } from "@/lib/training/schedule-reset";
import { createActiveCycle, generateScheduledSessions } from "@/lib/training/schedule";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";
import type { ScheduledSession, TrainingSession } from "@/lib/types";

const START = "2026-09-21";
const RESET_DATE = "2026-09-22";

function legacyMakeup(
  base: ScheduledSession,
  id: string,
  originalDate: string,
  role: ScheduledSession["day_role"],
  routineId: string,
): ScheduledSession {
  return normalizeScheduledSession({
    ...base,
    id,
    date: "2026-09-23",
    original_date: originalDate,
    day_role: role,
    routine_template_id: routineId,
    status: "scheduled",
    generated_from_schedule: false,
    auto_rescheduled: true,
    manually_rescheduled: false,
    rescheduled_from_id: `missed-${id}`,
  });
}

describe("future schedule reset", () => {
  it("removes legacy future makeups and rebuilds a clean calendar", () => {
    const cycle = createActiveCycle("user-1", START);
    const normal = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
    });
    const wed = normal.find((row) => row.date === "2026-09-23")!;
    const legacyStrength = legacyMakeup(
      wed,
      "legacy-strength",
      "2026-09-21",
      "strength_power",
      "routine-monday",
    );
    const legacySaturday = legacyMakeup(
      wed,
      "legacy-saturday",
      "2026-09-19",
      "calisthenics_volume",
      "routine-saturday",
    );

    const result = buildFutureScheduleReset({
      userId: "user-1",
      cycle,
      scheduledSessions: [...normal, legacyStrength, legacySaturday],
      trainingSessions: [],
      fromDate: RESET_DATE,
      weeksAhead: 4,
    });

    expect(result.removedIds).toContain("legacy-strength");
    expect(result.removedIds).toContain("legacy-saturday");

    const activeSep23 = result.scheduledSessions.filter(
      (row) =>
        row.date === "2026-09-23" &&
        row.status === "scheduled",
    );
    expect(activeSep23).toHaveLength(1);
    expect(activeSep23[0]!.day_role).toBe("athleticism_endurance");
  });

  it("removes future missed/skipped schedule-only history and regenerates a clean day", () => {
    const cycle = createActiveCycle("user-1", START);
    const normal = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
    });
    const wed = normal.find((row) => row.date === "2026-09-23")!;
    const missedHistory = normalizeScheduledSession({
      ...wed,
      id: "history-missed",
      status: "missed",
      generated_from_schedule: false,
      auto_rescheduled: true,
      original_date: "2026-09-19",
    });

    const result = buildFutureScheduleReset({
      userId: "user-1",
      cycle,
      scheduledSessions: [...normal, missedHistory],
      trainingSessions: [],
      fromDate: RESET_DATE,
      weeksAhead: 4,
    });

    expect(result.removedIds).toContain("history-missed");
    expect(
      result.scheduledSessions.find((row) => row.id === "history-missed"),
    ).toBeUndefined();
    expect(
      result.scheduledSessions.filter(
        (row) => row.date === "2026-09-23" && row.status === "scheduled",
      ),
    ).toHaveLength(1);
  });

  it("does not delete a future schedule row already linked to a training session", () => {
    const cycle = createActiveCycle("user-1", START);
    const normal = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
    });
    const wed = normal.find((row) => row.date === "2026-09-23")!;
    const linked: TrainingSession = {
      id: "training-linked",
      user_id: "user-1",
      scheduled_session_id: wed.id,
      routine_template_id: wed.routine_template_id,
      started_at: "2026-09-23T10:00:00.000Z",
      ended_at: null,
      status: "active",
      readiness_snapshot: null,
      notes: "",
      cycle_week: wed.cycle_week,
      overview_seen: true,
    };

    const result = buildFutureScheduleReset({
      userId: "user-1",
      cycle,
      scheduledSessions: normal,
      trainingSessions: [linked],
      fromDate: RESET_DATE,
      weeksAhead: 4,
    });

    expect(result.removedIds).not.toContain(wed.id);
    expect(result.scheduledSessions.some((row) => row.id === wed.id)).toBe(true);
  });
});
