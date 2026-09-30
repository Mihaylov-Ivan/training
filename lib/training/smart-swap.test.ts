import { describe, expect, it } from "vitest";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import { respectsMainWorkoutBoundaries } from "@/lib/training/adaptive-schedule";
import { smartAdjustScheduledSession } from "@/lib/training/smart-swap";
import { addDays } from "@/lib/utils";
import type { ScheduledSession, WellbeingCheckin } from "@/lib/types";

const START = "2026-09-14";

function setup() {
  const cycle = createActiveCycle("user-1", START);
  const sessions = generateScheduledSessions({
    userId: "user-1",
    cycle,
    weeksAhead: 8,
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

function fixedReplacementOn(
  sessions: ScheduledSession[],
  date: string,
): ScheduledSession | undefined {
  return sessions.find(
    (session) =>
      session.date === date &&
      session.missed_note?.startsWith("Fixed replacement:"),
  );
}

function movedOriginal(
  sessions: ScheduledSession[],
  role: "swim_performance" | "swim_recovery" | "climbing",
): ScheduledSession | undefined {
  return sessions.find(
    (session) =>
      session.day_role === role &&
      session.status === "scheduled" &&
      session.missed_note?.startsWith(
        "Moved original after replacement:",
      ),
  );
}

describe("smart schedule adjustment", () => {
  it("keeps a swimming replacement fixed and moves the original swim", () => {
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

    const replacement = fixedReplacementOn(
      result.updated_sessions,
      swim.date,
    )!;
    expect(replacement.day_role).toBe("boxing");
    expect(replacement.routine_template_id).toBe("routine-boxing");

    const moved = movedOriginal(
      result.updated_sessions,
      "swim_performance",
    )!;
    expect(moved).toBeTruthy();
    expect(moved.date > swim.date).toBe(true);
    expect(moved.generated_from_schedule).toBe(false);
    expect(moved.missed_note).toContain("replacement-history=boxing");

    expect(
      result.updated_sessions.some(
        (session) =>
          session.date === swim.date &&
          session.day_role === "daily_skill_practice" &&
          session.status === "scheduled",
      ),
    ).toBe(true);
  });

  it("preserves fixed replacement and moved original through schedule regeneration", () => {
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
    const replacement = fixedReplacementOn(
      result.updated_sessions,
      swim.date,
    )!;
    const moved = movedOriginal(
      result.updated_sessions,
      "swim_performance",
    )!;

    const afterRefresh = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 8,
      existing: result.updated_sessions,
    });

    expect(
      afterRefresh.find((session) => session.id === replacement.id)
        ?.date,
    ).toBe(swim.date);
    expect(
      afterRefresh.find((session) => session.id === moved.id)?.date,
    ).toBe(moved.date);
    expect(
      afterRefresh.some(
        (session) =>
          session.date === swim.date &&
          session.day_role === "swim_performance" &&
          session.status === "scheduled",
      ),
    ).toBe(false);
  });

  it("a second explicit substitute acts on the moved swim and advances Boxing → Gym", () => {
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
    const movedOnce = movedOriginal(
      first.updated_sessions,
      "swim_performance",
    )!;

    const second = smartAdjustScheduledSession({
      scheduledId: movedOnce.id,
      sessions: first.updated_sessions,
      cycle,
      wellbeingCheckins: [highReadiness(movedOnce.date)],
      today: START,
    });

    expect(second.changed).toBe(true);
    const gymReplacement = fixedReplacementOn(
      second.updated_sessions,
      movedOnce.date,
    )!;
    expect(gymReplacement.day_role).toBe("gym_workout");
    expect(gymReplacement.routine_template_id).toBe(
      "routine-gym-replacement",
    );

    const movedTwice = movedOriginal(
      second.updated_sessions,
      "swim_performance",
    )!;
    expect(movedTwice.date > movedOnce.date).toBe(true);
    expect(movedTwice.missed_note).toContain(
      "replacement-history=boxing,gym",
    );
    expect(respectsMainWorkoutBoundaries(second.updated_sessions)).toBe(
      true,
    );
  });

  it("does not move or smart-swap a fixed replacement", () => {
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
    const replacement = fixedReplacementOn(
      first.updated_sessions,
      swim.date,
    )!;

    const attempted = smartAdjustScheduledSession({
      scheduledId: replacement.id,
      sessions: first.updated_sessions,
      cycle,
      wellbeingCheckins: [highReadiness(replacement.date)],
      today: START,
    });

    expect(attempted.changed).toBe(false);
    expect(
      attempted.updated_sessions.find(
        (session) => session.id === replacement.id,
      )?.date,
    ).toBe(swim.date);
  });

  it("replaces climbing with skill-inclusive Gym while moving climbing forward", () => {
    const { cycle, sessions } = setup();
    const climb = sessions.find(
      (session) =>
        session.day_role === "climbing" &&
        session.status === "scheduled",
    )!;

    const result = smartAdjustScheduledSession({
      scheduledId: climb.id,
      sessions,
      cycle,
      wellbeingCheckins: [highReadiness(climb.date)],
      today: START,
    });

    expect(result.changed).toBe(true);
    const replacement = fixedReplacementOn(
      result.updated_sessions,
      climb.date,
    )!;
    expect(replacement.day_role).toBe("gym_workout");
    expect(replacement.routine_template_id).toBe(
      "routine-gym-replacement-skills",
    );

    const moved = movedOriginal(result.updated_sessions, "climbing")!;
    expect(moved.date > climb.date).toBe(true);
    expect(
      result.updated_sessions.some(
        (session) =>
          session.date === climb.date &&
          session.day_role === "daily_skill_practice" &&
          session.status === "scheduled",
      ),
    ).toBe(false);
    expect(respectsMainWorkoutBoundaries(result.updated_sessions)).toBe(
      true,
    );
  });

  it("still smart-swaps ordinary short sessions and leaves daily skills attached", () => {
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

  it("never smart-swaps the daily light skill card itself", () => {
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
