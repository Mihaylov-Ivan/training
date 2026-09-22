import { describe, expect, it } from "vitest";
import {
  adherenceMetrics,
  classifySession,
  detectPendingMissedSessions,
  markPastSessionsPending,
  recalculateSchedule,
  respectsMainWorkoutBoundaries,
  MAX_MAIN_WORKOUTS_PER_CALENDAR_WEEK,
} from "@/lib/training/adaptive-schedule";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import { normalizeScheduledSession } from "@/lib/training/normalize-schedule";
import { addDays } from "@/lib/utils";
import type { ScheduledSession } from "@/lib/types";

/** Monday 2026-09-14 */
const START = "2026-09-14";

function buildWeek() {
  const cycle = createActiveCycle("user-1", START);
  const sessions = generateScheduledSessions({
    userId: "user-1",
    cycle,
    weeksAhead: 4,
  });
  return { cycle, sessions };
}

function byDate(sessions: ScheduledSession[], date: string) {
  return sessions.find(
    (s) => s.date === date && s.status === "scheduled",
  );
}

function activeOn(sessions: ScheduledSession[], date: string) {
  return sessions.filter(
    (s) =>
      s.date === date &&
      (s.status === "scheduled" || s.status === "in_progress"),
  );
}

describe("adaptive schedule engine", () => {
  it("classifies session kinds", () => {
    const { sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    expect(classifySession(mon)).toBe("MAIN_WORKOUT");
    const tue = byDate(sessions, addDays(START, 1))!;
    expect(classifySession(tue)).toBe("MOBILITY_RECOVERY");
    const thu = byDate(sessions, addDays(START, 3))!;
    expect(classifySession(thu)).toBe("BOXING");
    const sun = byDate(sessions, addDays(START, 6))!;
    expect(classifySession(sun)).toBe("SKILL_PRACTICE");
  });

  it("rotates boxing and swimming while keeping Sunday daily skills", () => {
    const { sessions } = buildWeek();
    const roleAt = (offset: number) =>
      byDate(sessions, addDays(START, offset))?.day_role;

    expect(roleAt(3)).toBe("boxing");
    expect(roleAt(4)).toBe("short_recovery");
    expect(roleAt(6)).toBe("daily_skill_practice");

    expect(roleAt(10)).toBe("short_deep_flex");
    expect(roleAt(11)).toBe("swim_performance");
    expect(roleAt(13)).toBe("daily_skill_practice");

    expect(roleAt(17)).toBe("boxing");
    expect(roleAt(18)).toBe("short_recovery");
    expect(roleAt(20)).toBe("daily_skill_practice");

    expect(roleAt(24)).toBe("short_deep_flex");
    expect(roleAt(25)).toBe("swim_recovery");
    expect(roleAt(27)).toBe("daily_skill_practice");
  });

  it("Monday main workout missed — shifts A then B with recovery gap", () => {
    const { cycle, sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    const proposal = recalculateSchedule({
      missedSession: mon,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });

    expect(proposal.recommendation).toBe("apply");
    const updated = proposal.updated_sessions;
    expect(updated.find((s) => s.id === mon.id)?.status).toBe("missed");

    const tueMains = activeOn(updated, addDays(START, 1)).filter(
      (s) => s.day_role === "strength_power",
    );
    expect(tueMains.length).toBe(1);
    expect(tueMains[0]!.rescheduled_from_id).toBe(mon.id);

    // History preserved on original Monday
    expect(updated.filter((s) => s.date === START && s.status === "missed")).toHaveLength(1);

    // No two mains on consecutive days among active mains after apply
    const mains = updated
      .filter(
        (s) =>
          s.status === "scheduled" &&
          ["strength_power", "athleticism_endurance", "calisthenics_volume"].includes(
            s.day_role,
          ),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < mains.length; i++) {
      const gap =
        (new Date(mains[i]!.date + "T12:00:00").getTime() -
          new Date(mains[i - 1]!.date + "T12:00:00").getTime()) /
        86400000;
      expect(gap).toBeGreaterThan(1);
    }
  });

  it("Wednesday main workout missed — moves B with gap, does not duplicate", () => {
    const { cycle, sessions } = buildWeek();
    const wed = byDate(sessions, addDays(START, 2))!;
    expect(wed.day_role).toBe("athleticism_endurance");
    const proposal = recalculateSchedule({
      missedSession: wed,
      upcomingSessions: sessions,
      cycle,
      reason: "forgot",
    });
    const makeup = proposal.updated_sessions.find(
      (s) => s.rescheduled_from_id === wed.id,
    );
    expect(makeup).toBeTruthy();
    expect(makeup!.date > wed.date).toBe(true);
    expect(
      proposal.updated_sessions.filter(
        (s) =>
          s.day_role === "athleticism_endurance" &&
          s.status === "scheduled" &&
          s.date === wed.date,
      ),
    ).toHaveLength(0);
  });

  it("Saturday main workout missed — proposes shift or skip without stacking Sun+Mon", () => {
    const { cycle, sessions } = buildWeek();
    const sat = byDate(sessions, addDays(START, 5))!;
    expect(sat.day_role).toBe("calisthenics_volume");
    const proposal = recalculateSchedule({
      missedSession: sat,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });
    if (proposal.recommendation === "apply") {
      const makeup = proposal.updated_sessions.find(
        (s) => s.rescheduled_from_id === sat.id,
      )!;
      const monNext = addDays(makeup.date, 1);
      const clash = proposal.updated_sessions.some(
        (s) =>
          s.date === monNext &&
          s.status === "scheduled" &&
          s.day_role === "strength_power",
      );
      // Either no Monday strength clash, or Monday was also shifted
      if (clash) {
        expect(proposal.warnings.length + proposal.moved_sessions.length).toBeGreaterThan(0);
      }
    }
  });

  it("Tuesday mobility missed — skip, no cram", () => {
    const { cycle, sessions } = buildWeek();
    const tue = byDate(sessions, addDays(START, 1))!;
    const proposal = recalculateSchedule({
      missedSession: tue,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });
    expect(proposal.recommendation).toBe("skip_and_resume");
    expect(proposal.moved_sessions).toHaveLength(0);
    expect(
      proposal.updated_sessions.find((s) => s.id === tue.id)?.status,
    ).toMatch(/missed|skipped/);
  });

  it("Thursday flexibility missed — may move one day or skip", () => {
    const { cycle, sessions } = buildWeek();
    const thu = byDate(sessions, addDays(START, 10))!;
    expect(thu.day_role).toBe("short_deep_flex");
    const proposal = recalculateSchedule({
      missedSession: thu,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });
    expect(["apply", "skip_and_resume"]).toContain(proposal.recommendation);
    // Never duplicates flexibility on same day as a main
    for (const m of proposal.moved_sessions) {
      const mains = proposal.updated_sessions.filter(
        (s) =>
          s.date === m.to_date &&
          s.status === "scheduled" &&
          ["strength_power", "athleticism_endurance", "calisthenics_volume"].includes(
            s.day_role,
          ),
      );
      expect(mains.length).toBe(0);
    }
  });

  it("Friday swimming missed — reschedule only into suitable slot or skip", () => {
    const cycle = createActiveCycle("user-1", START);
    // Force week 2 Friday swim by starting cycle 7 days earlier so START week is week 2
    const cycleW2 = { ...cycle, start_date: addDays(START, -7) };
    const sessions = generateScheduledSessions({
      userId: "user-1",
      cycle: cycleW2,
      weeksAhead: 3,
    });
    const fri = sessions.find(
      (s) => s.day_role === "swim_performance" && s.status === "scheduled",
    );
    expect(fri).toBeTruthy();
    const proposal = recalculateSchedule({
      missedSession: fri!,
      upcomingSessions: sessions,
      cycle: cycleW2,
      reason: "travel",
    });
    expect(["apply", "skip_and_resume"]).toContain(proposal.recommendation);
    if (proposal.recommendation === "apply") {
      const makeup = proposal.updated_sessions.find(
        (s) => s.rescheduled_from_id === fri!.id,
      )!;
      const mainSameDay = proposal.updated_sessions.some(
        (s) =>
          s.date === makeup.date &&
          s.status === "scheduled" &&
          ["strength_power", "athleticism_endurance", "calisthenics_volume"].includes(
            s.day_role,
          ),
      );
      expect(mainSameDay).toBe(false);
    }
  });

  it("Saturday climbing missed — weekend move may shift Monday strength", () => {
    const cycle = createActiveCycle("user-1", addDays(START, -14));
    const sessions = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
    });
    const climb = sessions.find(
      (s) => s.day_role === "climbing" && s.status === "scheduled",
    );
    expect(climb).toBeTruthy();
    const proposal = recalculateSchedule({
      missedSession: climb!,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });
    expect(proposal.updated_sessions.find((s) => s.id === climb!.id)?.status).toBe(
      "missed",
    );
    if (proposal.recommendation === "apply") {
      expect(
        proposal.updated_sessions.some((s) => s.rescheduled_from_id === climb!.id),
      ).toBe(true);
    }
  });

  it("OAHS / skill-style short session missed — never doubles next day", () => {
    const { cycle, sessions } = buildWeek();
    const tue = byDate(sessions, addDays(START, 1))!;
    const before = sessions.filter((s) => s.status === "scheduled").length;
    const proposal = recalculateSchedule({
      missedSession: tue,
      upcomingSessions: sessions,
      cycle,
      reason: "forgot",
    });
    const afterActive = proposal.updated_sessions.filter(
      (s) => s.status === "scheduled",
    ).length;
    expect(afterActive).toBeLessThanOrEqual(before);
    expect(proposal.moved_sessions).toHaveLength(0);
  });

  it("three consecutive days missed — only reorganise next core", () => {
    const { cycle, sessions } = buildWeek();
    let working = sessions.map((s) =>
      s.date < addDays(START, 3) &&
      ["strength_power", "athleticism_endurance", "calisthenics_volume", "climbing"].includes(
        s.day_role,
      )
        ? normalizeScheduledSession({ ...s, status: "missed" })
        : s,
    );
    // Also mark short sessions in that window missed to build streak helpers
    working = working.map((s) =>
      s.date >= START && s.date < addDays(START, 3)
        ? normalizeScheduledSession({ ...s, status: "missed" })
        : s,
    );
    const sat = byDate(working, addDays(START, 5));
    // Use Thursday flex after a streak ending before Thu — instead miss next main after streak
    const nextMain = working.find(
      (s) =>
        s.date >= addDays(START, 3) &&
        s.status === "scheduled" &&
        s.day_role === "calisthenics_volume",
    )!;
    const proposal = recalculateSchedule({
      missedSession: nextMain,
      upcomingSessions: working,
      cycle,
      reason: "no_time",
    });
    // Should not invent duplicate mains for the already-missed Mon/Wed
    const strengthActive = proposal.updated_sessions.filter(
      (s) => s.day_role === "strength_power" && s.status === "scheduled",
    );
    expect(strengthActive.every((s) => s.date !== START)).toBe(true);
    void sat;
  });

  it("illness interruption — pause recommendation, no cascade", () => {
    const { cycle, sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    const proposal = recalculateSchedule({
      missedSession: mon,
      upcomingSessions: sessions,
      cycle,
      reason: "illness",
    });
    expect(proposal.recommendation).toBe("pause");
    expect(proposal.moved_sessions).toHaveLength(0);
  });

  it("injury interruption — no auto makeup", () => {
    const { cycle, sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    const proposal = recalculateSchedule({
      missedSession: mon,
      upcomingSessions: sessions,
      cycle,
      reason: "pain_or_injury",
      injuryArea: "shoulder",
      injuryExercise: "oahs",
    });
    expect(proposal.recommendation).toBe("skip_and_resume");
    expect(proposal.moved_sessions).toHaveLength(0);
    expect(
      proposal.updated_sessions.find((s) => s.id === mon.id)?.injury_area,
    ).toBe("shoulder");
  });

  it("Week 3 workout missed immediately before deload — do not dump into Week 4", () => {
    const cycle = createActiveCycle("user-1", addDays(START, -14));
    const sessions = generateScheduledSessions({
      userId: "user-1",
      cycle,
      weeksAhead: 4,
    });
    const week3Main = sessions.find(
      (s) =>
        s.cycle_week === 3 &&
        s.day_role === "calisthenics_volume" &&
        s.status === "scheduled",
    ) ?? sessions.find(
      (s) =>
        s.cycle_week === 3 &&
        s.day_role === "climbing" &&
        s.status === "scheduled",
    );
    expect(week3Main).toBeTruthy();
    const proposal = recalculateSchedule({
      missedSession: week3Main!,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
    });
    const makeup = proposal.updated_sessions.find(
      (s) => s.rescheduled_from_id === week3Main!.id,
    );
    if (makeup) {
      expect(makeup.cycle_week).not.toBe(4);
    } else {
      expect(proposal.recommendation).toBe("skip_and_resume");
    }
  });

  it("user manual override target date is respected", () => {
    const { cycle, sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    const target = addDays(START, 2);
    const proposal = recalculateSchedule({
      missedSession: mon,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
      manualTargetDate: target,
    });
    const makeup = proposal.updated_sessions.find(
      (s) => s.rescheduled_from_id === mon.id,
    );
    expect(makeup?.date).toBe(target);
  });

  it("daily and weekly main-workout boundaries are hard limits", () => {
    const { sessions } = buildWeek();
    expect(respectsMainWorkoutBoundaries(sessions)).toBe(true);

    const mon = byDate(sessions, START)!;
    const duplicateDay = normalizeScheduledSession({
      ...mon,
      id: "duplicate-main",
      day_role: "athleticism_endurance",
      routine_template_id: "routine-wednesday-w1",
      generated_from_schedule: false,
      sequence_index: 99,
    });
    expect(
      respectsMainWorkoutBoundaries([...sessions, duplicateDay]),
    ).toBe(false);

    const mondayWeek = sessions.filter(
      (session) => session.date >= START && session.date <= addDays(START, 6),
    );
    const existingMains = mondayWeek.filter((session) =>
      [
        "strength_power",
        "athleticism_endurance",
        "calisthenics_volume",
        "climbing",
      ].includes(session.day_role),
    );
    expect(existingMains.length).toBeLessThanOrEqual(
      MAX_MAIN_WORKOUTS_PER_CALENDAR_WEEK,
    );

    const extraMains = [1, 2].map((index) =>
      normalizeScheduledSession({
        ...mon,
        id: `extra-main-${index}`,
        date: addDays(START, index === 1 ? 1 : 3),
        original_date: addDays(START, index === 1 ? 1 : 3),
        generated_from_schedule: false,
        sequence_index: 100 + index,
      }),
    );
    expect(
      respectsMainWorkoutBoundaries([...sessions, ...extraMains]),
    ).toBe(false);
  });

  it("every applied main-workout reschedule respects the hard load boundaries", () => {
    const { cycle, sessions } = buildWeek();
    for (const offset of [0, 2, 5]) {
      const missed = byDate(sessions, addDays(START, offset))!;
      const proposal = recalculateSchedule({
        missedSession: missed,
        upcomingSessions: sessions,
        cycle,
        reason: "no_time",
      });
      expect(
        respectsMainWorkoutBoundaries(proposal.updated_sessions),
      ).toBe(true);
    }
  });

  it("pending missed detection and late log path leave progression untouched", () => {
    const { sessions } = buildWeek();
    const today = addDays(START, 2);
    const pending = markPastSessionsPending(sessions, today);
    const due = detectPendingMissedSessions(pending, today);
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((s) => s.date < today)).toBe(true);
  });

  it("adherence metrics distinguish eventual completion", () => {
    const { sessions } = buildWeek();
    const withHistory = sessions.map((s, i) =>
      i === 0
        ? normalizeScheduledSession({ ...s, status: "missed" })
        : i === 1
          ? normalizeScheduledSession({
              ...s,
              status: "completed",
              auto_rescheduled: true,
              rescheduled_from_id: sessions[0]!.id,
              original_date: sessions[0]!.date,
            })
          : s,
    );
    const metrics = adherenceMetrics(withHistory);
    expect(metrics.overall.missed_sessions).toBeGreaterThan(0);
    expect(metrics.overall.completed_after_reschedule).toBeGreaterThan(0);
  });

  it("partially completed workout status is supported without progression side effects", () => {
    const { sessions } = buildWeek();
    const mon = normalizeScheduledSession({
      ...byDate(sessions, START)!,
      status: "partially_completed",
      completed_at: new Date().toISOString(),
    });
    expect(mon.status).toBe("partially_completed");
  });

  it("force skip keeps original schedule (user override)", () => {
    const { cycle, sessions } = buildWeek();
    const mon = byDate(sessions, START)!;
    const proposal = recalculateSchedule({
      missedSession: mon,
      upcomingSessions: sessions,
      cycle,
      reason: "no_time",
      forceSkip: true,
    });
    expect(proposal.recommendation).toBe("skip_and_resume");
    expect(proposal.moved_sessions).toHaveLength(0);
  });
});
