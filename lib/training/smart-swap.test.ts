import { describe, expect, it } from "vitest";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import {
  respectsMainWorkoutBoundaries,
} from "@/lib/training/adaptive-schedule";
import { smartAdjustScheduledSession } from "@/lib/training/smart-swap";
import { addDays } from "@/lib/utils";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";
import type { ScheduledSession, WellbeingCheckin } from "@/lib/types";

const START = "2026-09-14";

function setup() {
  const cycle = createActiveCycle("user-1", START);
  const sessions = generateScheduledSessions({
    userId: "user-1",
    cycle,
    weeksAhead: 4,
  });
  return { cycle, sessions };
}

function highReadiness(date: string): WellbeingCheckin {
  return {
    id: "wb-high",
    user_id: "user-1",
    date,
    sleep_quality_1_5: 5,
    energy_1_5: 5,
    soreness_0_10: 1,
    neck_pain_0_10: 0,
    back_pain_0_10: 0,
    notes: "",
  };
}

function activeMainCountOnDate(
  sessions: ScheduledSession[],
  date: string,
): number {
  return sessions.filter(
    (session) =>
      session.date === date &&
      [
        "strength_power",
        "athleticism_endurance",
        "calisthenics_volume",
        "climbing",
        "gym_workout",
      ].includes(session.day_role) &&
      [
        "scheduled",
        "in_progress",
        "completed",
        "partially_completed",
        "pending_missed_confirmation",
        "overdue",
      ].includes(session.status),
  ).length;
}

describe("smart schedule adjustment", () => {
  it("rebalances a main workout cleanly without creating missed history", () => {
    const { cycle, sessions } = setup();
    const monday = sessions.find(
      (session) =>
        session.date === START &&
        session.day_role === "strength_power" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: monday.id,
      sessions,
      cycle,
      wellbeingCheckins: [],
      today: START,
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("swap");
    expect(
      result.updated_sessions.some(
        (session) =>
          session.id === monday.id &&
          session.status === "missed",
      ),
    ).toBe(false);
    expect(respectsMainWorkoutBoundaries(result.updated_sessions)).toBe(true);
    expect(
      result.updated_sessions.some(
        (session) =>
          session.date === START &&
          session.day_role === "daily_skill_practice" &&
          session.status === "scheduled",
      ),
    ).toBe(true);

    for (const date of Array.from(
      new Set(result.updated_sessions.map((session) => session.date)),
    )) {
      expect(
        activeMainCountOnDate(result.updated_sessions, date),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("persists an auto substitution through schedule regeneration / refresh", () => {
    const { cycle, sessions } = setup();
    const swim = sessions.find(
      (session) =>
        session.day_role === "swim_performance" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(swim.date)],
      today: START,
    });

    const substituted = result.updated_sessions.find(
      (session) => session.id === swim.id,
    )!;
    expect(substituted.generated_from_schedule).toBe(false);
    expect(substituted.day_role).toBe("boxing");

    const afterRefresh = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
      existing: result.updated_sessions,
    });
    const persisted = afterRefresh.find(
      (session) => session.id === swim.id,
    )!;

    expect(persisted.day_role).toBe("boxing");
    expect(persisted.routine_template_id).toBe("routine-boxing");
    expect(persisted.generated_from_schedule).toBe(false);
  });

  it("a second auto substitute advances Swimming → Boxing → Gym and keeps hard limits", () => {
    const { cycle, sessions } = setup();
    const swim = sessions.find(
      (session) =>
        session.day_role === "swim_performance" &&
        session.status === "scheduled",
    )!;

    const first = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(swim.date)],
      today: START,
    });
    const boxing = first.updated_sessions.find(
      (session) => session.id === swim.id,
    )!;
    expect(boxing.day_role).toBe("boxing");
    expect(boxing.missed_note?.startsWith("Automatic substitute:")).toBe(
      true,
    );

    const second = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions: first.updated_sessions,
      cycle,
      wellbeingCheckins: [highReadiness(swim.date)],
      today: START,
    });
    const gym = second.updated_sessions.find(
      (session) => session.id === swim.id,
    )!;

    expect(second.changed).toBe(true);
    expect(second.action).toBe("substitute");
    expect(gym.day_role).toBe("gym_workout");
    expect(gym.routine_template_id).toBe("routine-gym-replacement");
    expect(gym.generated_from_schedule).toBe(false);
    expect(respectsMainWorkoutBoundaries(second.updated_sessions)).toBe(
      true,
    );

    for (const date of Array.from(
      new Set(second.updated_sessions.map((session) => session.date)),
    )) {
      expect(
        activeMainCountOnDate(second.updated_sessions, date),
      ).toBeLessThanOrEqual(1);
    }

    const afterRefresh = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
      existing: second.updated_sessions,
    });
    const persisted = afterRefresh.find(
      (session) => session.id === swim.id,
    )!;
    expect(persisted.day_role).toBe("gym_workout");
    expect(persisted.routine_template_id).toBe(
      "routine-gym-replacement",
    );
    expect(
      afterRefresh.some(
        (session) =>
          session.date === swim.original_date &&
          (session.day_role === "swim_performance" ||
            session.day_role === "swim_recovery") &&
          session.status === "scheduled",
      ),
    ).toBe(false);

    const third = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions: second.updated_sessions,
      cycle,
      wellbeingCheckins: [highReadiness(gym.date)],
      today: START,
    });
    expect(third.changed).toBe(false);
    expect(
      third.updated_sessions.find((session) => session.id === swim.id)
        ?.day_role,
    ).toBe("gym_workout");
  });

  it("a climbing-derived Gym session is the final fallback and does not cycle", () => {
    const { cycle, sessions } = setup();
    const climbing = sessions.find(
      (session) =>
        session.day_role === "climbing" &&
        session.status === "scheduled",
    )!;

    const first = smartAdjustScheduledSession({
      scheduledId: climbing.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(climbing.date)],
      today: START,
    });
    expect(
      first.updated_sessions.find(
        (session) => session.id === climbing.id,
      )?.day_role,
    ).toBe("gym_workout");

    const second = smartAdjustScheduledSession({
      scheduledId: climbing.id,
      sessions: first.updated_sessions,
      cycle,
      wellbeingCheckins: [highReadiness(climbing.date)],
      today: START,
    });
    expect(second.changed).toBe(false);
    expect(
      second.updated_sessions.find(
        (session) => session.id === climbing.id,
      )?.day_role,
    ).toBe("gym_workout");
  });

  it("swimming becomes boxing in a normal week rather than adding a fourth-style strength demand", () => {
    const { cycle, sessions } = setup();
    const swim = sessions.find(
      (session) =>
        session.day_role === "swim_performance" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(swim.date)],
      today: START,
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("substitute");
    const replacement = result.updated_sessions.find(
      (session) => session.id === swim.id,
    )!;
    expect(replacement.day_role).toBe("boxing");
    expect(replacement.routine_template_id).toBe("routine-boxing");
    expect(
      result.updated_sessions.some(
        (session) =>
          session.date === swim.date &&
          session.day_role === "daily_skill_practice" &&
          session.status === "scheduled",
      ),
    ).toBe(true);
  });

  it("swimming can become gym when the week lost a main stimulus and recovery allows it", () => {
    const { cycle, sessions } = setup();
    const swim = sessions.find(
      (session) =>
        session.day_role === "swim_performance" &&
        session.status === "scheduled",
    )!;
    const weekStart = addDays(swim.date, -4); // Friday -> Monday in this plan week

    const depleted = sessions.map((session) => {
      if (
        session.date >= weekStart &&
        session.date <= addDays(weekStart, 6) &&
        (session.day_role === "strength_power" ||
          session.day_role === "calisthenics_volume")
      ) {
        return normalizeScheduledSession({
          ...session,
          status: "missed",
        });
      }
      return session;
    });

    const result = smartAdjustScheduledSession({
      scheduledId: swim.id,
      sessions: depleted,
      cycle,
      wellbeingCheckins: [highReadiness(swim.date)],
      today: weekStart,
    });

    const replacement = result.updated_sessions.find(
      (session) => session.id === swim.id,
    )!;
    expect(replacement.day_role).toBe("gym_workout");
    expect(replacement.routine_template_id).toBe(
      "routine-gym-replacement",
    );
    expect(respectsMainWorkoutBoundaries(result.updated_sessions)).toBe(true);
    expect(
      result.updated_sessions.some(
        (session) =>
          session.date === swim.date &&
          session.day_role === "daily_skill_practice" &&
          session.status === "scheduled",
      ),
    ).toBe(false);
  });

  it("climbing becomes a gym workout when readiness supports the closest training stimulus", () => {
    const { cycle, sessions } = setup();
    const climbing = sessions.find(
      (session) =>
        session.day_role === "climbing" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: climbing.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(climbing.date)],
      today: START,
    });

    const replacement = result.updated_sessions.find(
      (session) => session.id === climbing.id,
    )!;
    expect(replacement.day_role).toBe("gym_workout");
    expect(replacement.routine_template_id).toBe(
      "routine-gym-replacement",
    );
    expect(respectsMainWorkoutBoundaries(result.updated_sessions)).toBe(true);
  });

  it("persists a smart date swap through schedule regeneration / refresh", () => {
    const { cycle, sessions } = setup();
    const mobility = sessions.find(
      (session) =>
        session.date === addDays(START, 1) &&
        session.day_role === "short_mobility_front" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: mobility.id,
      sessions,
      cycle,
      wellbeingCheckins: [],
      today: START,
    });
    expect(result.changed).toBe(true);

    const moved = result.updated_sessions.find(
      (session) => session.id === mobility.id,
    )!;
    expect(moved.generated_from_schedule).toBe(false);

    const afterRefresh = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
      existing: result.updated_sessions,
    });
    const persisted = afterRefresh.find(
      (session) => session.id === mobility.id,
    )!;
    expect(persisted.date).toBe(moved.date);
    expect(persisted.day_role).toBe(moved.day_role);
  });

  it("short sessions are swapped automatically while daily skills stay attached to both dates", () => {
    const { cycle, sessions } = setup();
    const mobility = sessions.find(
      (session) =>
        session.date === addDays(START, 1) &&
        session.day_role === "short_mobility_front" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: mobility.id,
      sessions,
      cycle,
      wellbeingCheckins: [],
      today: START,
    });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("swap");
    const moved = result.updated_sessions.find(
      (session) => session.id === mobility.id,
    )!;
    expect(moved.date).not.toBe(mobility.date);

    for (const date of [mobility.date, moved.date]) {
      expect(
        result.updated_sessions.some(
          (session) =>
            session.date === date &&
            session.day_role === "daily_skill_practice" &&
            session.status === "scheduled",
        ),
      ).toBe(true);
    }
  });

  it("daily OAHS + planche itself is never auto-swapped", () => {
    const { cycle, sessions } = setup();
    const skill = sessions.find(
      (session) =>
        session.day_role === "daily_skill_practice" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: skill.id,
      sessions,
      cycle,
      wellbeingCheckins: [],
      today: START,
    });

    expect(result.changed).toBe(false);
    expect(result.action).toBe("none");
  });
});
