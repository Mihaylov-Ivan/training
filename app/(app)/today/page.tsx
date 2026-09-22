"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById } from "@/lib/seed/routines";
import type { TrainingSession } from "@/lib/types";
import {
  formatDuration,
  greetingForNow,
  readinessPercent,
  todayISO,
} from "@/lib/utils";
import {
  Badge,
  Card,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";
import {
  isPrimaryRole,
  isShortRole,
} from "@/lib/training/schedule";
import { cycleWeekForDate } from "@/lib/training/schedule";
import { MissedSessionPrompt } from "@/components/schedule/missed-session-prompt";
import { ScheduleAdjustmentPreview } from "@/components/schedule/schedule-adjustment-preview";

const MAINTENANCE_ROUTINE_ID = "routine-maintenance";

function sessionDay(session: TrainingSession): string | null {
  const stamp = session.ended_at ?? session.started_at;
  return stamp ? stamp.slice(0, 10) : null;
}

function latestSessionForDay(
  sessions: TrainingSession[],
  opts: { routineId?: string; scheduledId?: string; day: string },
): TrainingSession | undefined {
  return sessions
    .filter((t) => {
      if (opts.routineId && t.routine_template_id !== opts.routineId) return false;
      if (opts.scheduledId && t.scheduled_session_id !== opts.scheduledId)
        return false;
      return sessionDay(t) === opts.day;
    })
    .sort((a, b) => {
      const aT = a.ended_at ?? a.started_at ?? "";
      const bT = b.ended_at ?? b.started_at ?? "";
      return bT.localeCompare(aT);
    })[0];
}

function itemsAllFinished(
  sessionId: string,
  items: { training_session_id: string; status: string }[],
): boolean {
  const mine = items.filter((i) => i.training_session_id === sessionId);
  return (
    mine.length > 0 &&
    mine.every((i) =>
      ["completed", "partial", "skipped", "pain_limited"].includes(i.status),
    )
  );
}

export default function TodayPage() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const cycles = useAppStore((s) => s.cycles);
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const trainingSessions = useAppStore((s) => s.trainingSessions);
  const sessionItems = useAppStore((s) => s.sessionItems);
  const wellbeing = useAppStore((s) => s.wellbeingCheckins);
  const startSessionFromScheduled = useAppStore((s) => s.startSessionFromScheduled);
  const startMaintenance = useAppStore((s) => s.startMaintenance);
  const completeSession = useAppStore((s) => s.completeSession);
  const beginManualMiss = useAppStore((s) => s.beginManualMiss);
  const saveWellbeing = useAppStore((s) => s.saveWellbeing);

  const today = todayISO();
  const cycle = cycles[0];
  const week = cycle ? cycleWeekForDate(cycle.start_date, today) : 1;
  const todaySched = useMemo(() => {
    const rows = scheduled.filter((s) => s.date === today);
    const actionable = rows.filter((s) =>
      [
        "scheduled",
        "in_progress",
        "completed",
        "partially_completed",
        "pending_missed_confirmation",
      ].includes(s.status),
    );
    // Never treat a missed/skipped row as today's startable workout
    return (
      actionable.find((s) => isPrimaryRole(s.day_role)) ??
      actionable.find(
        (s) =>
          isShortRole(s.day_role) &&
          s.day_role !== "daily_skill_practice",
      ) ??
      actionable.find((s) => s.day_role !== "daily_skill_practice") ??
      actionable[0]
    );
  }, [scheduled, today]);

  const todaySkillSched = useMemo(() => {
    return scheduled.find(
      (session) =>
        session.date === today &&
        session.day_role === "daily_skill_practice" &&
        [
          "scheduled",
          "in_progress",
          "completed",
          "partially_completed",
          "pending_missed_confirmation",
        ].includes(session.status),
    );
  }, [scheduled, today]);

  const todayMissed = useMemo(() => {
    return scheduled
      .filter(
        (s) =>
          s.date === today &&
          (s.status === "missed" || s.status === "skipped") &&
          (isPrimaryRole(s.day_role) || isShortRole(s.day_role)),
      )
      .sort((a, b) => {
        // Prefer primary workouts in the missed list
        const ap = isPrimaryRole(a.day_role) ? 0 : 1;
        const bp = isPrimaryRole(b.day_role) ? 0 : 1;
        return ap - bp;
      });
  }, [scheduled, today]);

  const makeupForMissed = useMemo(() => {
    return todayMissed
      .map((missed) => ({
        missed,
        makeup: scheduled.find(
          (s) =>
            s.rescheduled_from_id === missed.id &&
            (s.status === "scheduled" ||
              s.status === "in_progress" ||
              s.status === "completed" ||
              s.status === "partially_completed"),
        ),
      }))
      .filter((x) => x.makeup);
  }, [todayMissed, scheduled]);

  const checkin = wellbeing.find((w) => w.date === today);
  const ready = readinessPercent(checkin ?? null);

  const scanPendingMissedSessions = useAppStore((s) => s.scanPendingMissedSessions);
  useEffect(() => {
    scanPendingMissedSessions();
  }, [scanPendingMissedSessions, scheduled.length]);

  const weekSessions = useMemo(() => {
    if (!cycle) return [];
    return scheduled.filter((s) => {
      const cw = cycleWeekForDate(cycle.start_date, s.date);
      return (
        cw === week &&
        (isPrimaryRole(s.day_role) || isShortRole(s.day_role))
      );
    });
  }, [scheduled, cycle, week]);

  const completedThisWeek = weekSessions.filter(
    (s) => s.status === "completed" || s.status === "partially_completed",
  ).length;
  const totalThisWeek = weekSessions.filter(
    (s) =>
      s.status !== "missed" &&
      s.status !== "skipped" &&
      s.status !== "cancelled",
  ).length;

  const todayMaintenance = useMemo(
    () =>
      latestSessionForDay(trainingSessions, {
        routineId: MAINTENANCE_ROUTINE_ID,
        day: today,
      }) ??
      // Fallback: unfinished session with no day stamp yet
      trainingSessions
        .filter(
          (t) =>
            t.routine_template_id === MAINTENANCE_ROUTINE_ID &&
            (t.status === "planned" || t.status === "active") &&
            !sessionDay(t),
        )
        .at(-1),
    [trainingSessions, today],
  );

  const maintenanceDone =
    todayMaintenance?.status === "completed" ||
    (!!todayMaintenance && itemsAllFinished(todayMaintenance.id, sessionItems));
  const maintenanceInProgress =
    !maintenanceDone &&
    todayMaintenance &&
    (todayMaintenance.status === "active" ||
      todayMaintenance.status === "planned");

  const todayPrimary = useMemo(() => {
    if (!todaySched) return undefined;
    return (
      latestSessionForDay(trainingSessions, {
        scheduledId: todaySched.id,
        day: today,
      }) ??
      trainingSessions
        .filter((t) => t.scheduled_session_id === todaySched.id)
        .sort((a, b) => {
          const aT = a.ended_at ?? a.started_at ?? "";
          const bT = b.ended_at ?? b.started_at ?? "";
          return bT.localeCompare(aT);
        })[0]
    );
  }, [trainingSessions, todaySched, today]);

  const primaryDone =
    todaySched?.status === "completed" ||
    todaySched?.status === "partially_completed" ||
    todayPrimary?.status === "completed" ||
    (!!todayPrimary && itemsAllFinished(todayPrimary.id, sessionItems));
  const primaryInProgress =
    !primaryDone &&
    todayPrimary &&
    (todayPrimary.status === "active" || todayPrimary.status === "planned");

  const todaySkillSession = useMemo(() => {
    if (!todaySkillSched) return undefined;
    return (
      latestSessionForDay(trainingSessions, {
        scheduledId: todaySkillSched.id,
        day: today,
      }) ??
      trainingSessions
        .filter(
          (session) =>
            session.scheduled_session_id === todaySkillSched.id,
        )
        .sort((a, b) => {
          const aT = a.ended_at ?? a.started_at ?? "";
          const bT = b.ended_at ?? b.started_at ?? "";
          return bT.localeCompare(aT);
        })[0]
    );
  }, [trainingSessions, todaySkillSched, today]);

  const skillDone =
    todaySkillSched?.status === "completed" ||
    todaySkillSched?.status === "partially_completed" ||
    todaySkillSession?.status === "completed" ||
    (!!todaySkillSession &&
      itemsAllFinished(todaySkillSession.id, sessionItems));

  const skillInProgress =
    !skillDone &&
    todaySkillSession &&
    (todaySkillSession.status === "active" ||
      todaySkillSession.status === "planned");

  // Finalize sessions that finished all exercises but never hit "Done"
  useEffect(() => {
    if (
      todayMaintenance &&
      todayMaintenance.status !== "completed" &&
      itemsAllFinished(todayMaintenance.id, sessionItems)
    ) {
      completeSession(todayMaintenance.id);
    }
  }, [todayMaintenance, sessionItems, completeSession]);

  useEffect(() => {
    if (
      todayPrimary &&
      todayPrimary.status !== "completed" &&
      itemsAllFinished(todayPrimary.id, sessionItems)
    ) {
      completeSession(todayPrimary.id);
    }
  }, [todayPrimary, sessionItems, completeSession]);

  useEffect(() => {
    if (
      todaySkillSession &&
      todaySkillSession.status !== "completed" &&
      itemsAllFinished(todaySkillSession.id, sessionItems)
    ) {
      completeSession(todaySkillSession.id);
    }
  }, [todaySkillSession, sessionItems, completeSession]);

  const overdue =
    todaySched &&
    !primaryDone &&
    todaySched.status === "scheduled" &&
    !primaryInProgress &&
    new Date().getHours() >= 20;

  const nextShort = scheduled.find(
    (s) =>
      s.date > today &&
      isShortRole(s.day_role) &&
      s.status === "scheduled",
  );

  const routine = todaySched
    ? getRoutineById(todaySched.routine_template_id)
    : null;
  const skillRoutine = todaySkillSched
    ? getRoutineById(todaySkillSched.routine_template_id)
    : null;

  const [showCheckin, setShowCheckin] = useState(false);

  function launch(scheduledId: string) {
    const id = startSessionFromScheduled(scheduledId);
    router.push(`/session/${id}`);
  }

  function launchMaintenance() {
    const id = startMaintenance();
    router.push(`/session/${id}`);
  }

  if (!profile?.onboarding_complete) {
    return null;
  }

  const isSunday = todaySched?.day_role === "recovery";
  const isDeload = week === 4;
  const showRecoveryCard =
    todaySched?.day_role === "recovery" ||
    (!todaySched &&
      scheduled.some(
        (s) => s.date === today && s.day_role === "recovery",
      ));

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={`${greetingForNow()}`}
        subtitle={`Week ${week} of 4${isDeload ? " — Deload" : ""}`}
        action={
          ready != null ? (
            <Badge tone={ready >= 70 ? "success" : ready >= 45 ? "warning" : "danger"}>
              {ready}% ready
            </Badge>
          ) : (
            <SecondaryButton
              className="!min-h-10 !px-3 !text-sm"
              onClick={() => setShowCheckin(true)}
            >
              Check in
            </SecondaryButton>
          )
        }
      />

      {isDeload ? (
        <Card className="mb-4 border-warning/40 bg-warning-soft/40">
          <p className="font-semibold text-warning">Week 4 — Deload</p>
          <p className="mt-1 text-sm text-muted">
            Sets reduced, light planche, easier intensity. Recovery is the work.
          </p>
        </Card>
      ) : null}

      {checkin && (checkin.neck_pain_0_10 >= 4 || checkin.back_pain_0_10 >= 4) ? (
        <Card className="mb-4 border-danger/40 bg-danger-soft/30">
          <p className="font-semibold text-danger">Pain caution</p>
          <p className="mt-1 text-sm text-muted">
            Elevated neck/back pain logged. Training can continue, but progression may
            freeze on affected movements if pain ≥4/10 during a set.
          </p>
        </Card>
      ) : null}

      <div className="space-y-3">
        <Card
          className={
            maintenanceDone
              ? "border-success/40 bg-success-soft/30"
              : maintenanceInProgress
                ? "border-accent/40"
                : ""
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Daily maintenance
              </p>
              <h2 className="mt-1 text-lg font-semibold">5-minute mobility</h2>
              <p className="mt-1 text-sm text-muted">
                {maintenanceDone
                  ? "Completed today — neck, shoulders, spine, hips, ankles"
                  : "Neck + shoulders + spine + hips + ankles"}
              </p>
            </div>
            {maintenanceDone ? (
              <Badge tone="success">
                <span className="inline-flex items-center gap-1">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  Done
                </span>
              </Badge>
            ) : (
              <Badge tone={maintenanceInProgress ? "accent" : "neutral"}>
                {maintenanceInProgress ? "In progress" : "5 min"}
              </Badge>
            )}
          </div>
          {maintenanceDone ? (
            <div className="mt-4 flex gap-2">
              <SecondaryButton
                className="flex-1"
                onClick={() =>
                  todayMaintenance &&
                  router.push(`/session/${todayMaintenance.id}/summary`)
                }
              >
                View summary
              </SecondaryButton>
              <SecondaryButton className="flex-1" onClick={launchMaintenance}>
                Do again
              </SecondaryButton>
            </div>
          ) : maintenanceInProgress && todayMaintenance ? (
            <PrimaryButton
              className="mt-4 w-full"
              onClick={() => router.push(`/session/${todayMaintenance.id}`)}
            >
              Continue
            </PrimaryButton>
          ) : (
            <PrimaryButton className="mt-4 w-full" onClick={launchMaintenance}>
              Start
            </PrimaryButton>
          )}
        </Card>

        {todayMissed.length > 0 ? (
          <div className="space-y-3">
            {todayMissed.map((missed) => {
              const missedRoutine = getRoutineById(missed.routine_template_id);
              const pair = makeupForMissed.find((m) => m.missed.id === missed.id);
              const reasonLabel = missed.missed_reason
                ? missed.missed_reason.replaceAll("_", " ")
                : null;
              return (
                <Card
                  key={missed.id}
                  className="border-danger/40 bg-danger-soft/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-danger">
                        {missed.status === "skipped" ? "Skipped" : "Missed"} today
                      </p>
                      <h2 className="mt-1 text-lg font-semibold line-through decoration-danger/50">
                        {missedRoutine?.name ??
                          missed.day_role.replaceAll("_", " ")}
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        {reasonLabel
                          ? `Reason: ${reasonLabel}`
                          : "Logged as not completed."}
                        {pair?.makeup
                          ? ` · Moved to ${pair.makeup.date}`
                          : " · Not rescheduled"}
                      </p>
                    </div>
                    <Badge tone="danger">
                      {missed.status === "skipped" ? "Skipped" : "× Missed"}
                    </Badge>
                  </div>
                  {pair?.makeup ? (
                    <SecondaryButton
                      className="mt-4 w-full"
                      onClick={() => router.push("/plan")}
                    >
                      View new date on Plan
                    </SecondaryButton>
                  ) : null}
                </Card>
              );
            })}
          </div>
        ) : null}

        {todaySkillSched && skillRoutine ? (
          <Card
            className={
              skillDone
                ? "border-success/40 bg-success-soft/30"
                : "border-success/30"
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    skillDone ? "text-success" : "text-success"
                  }`}
                >
                  Daily skill practice
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {skillRoutine.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {skillDone
                    ? "Completed today."
                    : skillRoutine.description}
                </p>
              </div>
              {skillDone ? (
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <Check
                      className="size-3.5"
                      strokeWidth={3}
                      aria-hidden
                    />
                    Done
                  </span>
                </Badge>
              ) : (
                <Badge tone={skillInProgress ? "warning" : "success"}>
                  {skillInProgress
                    ? "In progress"
                    : formatDuration(skillRoutine.default_duration_min)}
                </Badge>
              )}
            </div>

            {skillDone && todaySkillSession ? (
              <SecondaryButton
                className="mt-4 w-full"
                onClick={() =>
                  router.push(
                    `/session/${todaySkillSession.id}/summary`,
                  )
                }
              >
                View summary
              </SecondaryButton>
            ) : skillInProgress && todaySkillSession ? (
              <div className="mt-4 space-y-2">
                <PrimaryButton
                  className="w-full"
                  onClick={() =>
                    router.push(`/session/${todaySkillSession.id}`)
                  }
                >
                  Continue skill practice
                </PrimaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => beginManualMiss(todaySkillSched.id)}
                >
                  Skip today
                </SecondaryButton>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <PrimaryButton
                  className="w-full"
                  onClick={() => launch(todaySkillSched.id)}
                >
                  Start skill practice
                </PrimaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => beginManualMiss(todaySkillSched.id)}
                >
                  Skip today
                </SecondaryButton>
              </div>
            )}
          </Card>
        ) : null}

        {todaySched &&
        routine &&
        todaySched.day_role !== "recovery" &&
        todaySched.id !== todaySkillSched?.id ? (
          <Card
            className={
              primaryDone
                ? "border-success/40 bg-success-soft/30"
                : "border-accent/30"
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    primaryDone ? "text-success" : "text-accent"
                  }`}
                >
                  {todaySched.rescheduled_from_id || todaySched.auto_rescheduled
                    ? "Rescheduled session"
                    : routine.kind === "short"
                      ? "Mobility / flexibility"
                      : routine.kind === "swim"
                        ? "Swimming"
                        : routine.kind === "boxing"
                          ? "Boxing"
                          : routine.kind === "climb"
                            ? "Climbing"
                            : "Main workout"}
                  {primaryDone ? " · Complete" : overdue ? " · Overdue" : ""}
                </p>
                <h2 className="mt-1 text-xl font-semibold">{routine.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {primaryDone
                    ? "Logged for today — nice work."
                    : todaySched.rescheduled_from_id || todaySched.auto_rescheduled
                      ? `Moved here from ${todaySched.original_date}. Your programme was adjusted.`
                      : routine.description}
                </p>
              </div>
              {primaryDone ? (
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                    Done
                  </span>
                </Badge>
              ) : todaySched.rescheduled_from_id || todaySched.auto_rescheduled ? (
                <Badge tone="accent">↪ Rescheduled</Badge>
              ) : (
                <Badge tone={overdue ? "warning" : "accent"}>
                  {primaryInProgress
                    ? "In progress"
                    : formatDuration(routine.default_duration_min)}
                </Badge>
              )}
            </div>
            {primaryDone && todayPrimary ? (
              <SecondaryButton
                className="mt-4 w-full"
                onClick={() =>
                  router.push(`/session/${todayPrimary.id}/summary`)
                }
              >
                View summary
              </SecondaryButton>
            ) : primaryInProgress && todayPrimary ? (
              <div className="mt-4 space-y-2">
                <PrimaryButton
                  className="w-full"
                  onClick={() => router.push(`/session/${todayPrimary.id}`)}
                >
                  Continue workout
                </PrimaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => beginManualMiss(todaySched.id)}
                >
                  Mark as missed
                </SecondaryButton>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <PrimaryButton
                  className="w-full"
                  onClick={() => launch(todaySched.id)}
                >
                  Start workout
                </PrimaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => beginManualMiss(todaySched.id)}
                >
                  Mark as missed
                </SecondaryButton>
              </div>
            )}
          </Card>
        ) : showRecoveryCard || isSunday ? (
          <Card>
            <Badge tone="accent">Recovery Day</Badge>
            <h2 className="mt-2 text-xl font-semibold">Sunday recovery</h2>
            <p className="mt-1 text-sm text-muted">
              Maintenance only today. Optional easy walking is encouraged — no structured
              workout.
            </p>
          </Card>
        ) : todayMissed.length === 0 && !todaySkillSched ? (
          <Card>
            <p className="text-sm text-muted">
              No structured workout scheduled for today.
            </p>
          </Card>
        ) : null}

        {nextShort ? (
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Next short session
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {getRoutineById(nextShort.routine_template_id)?.name}
            </h2>
            <p className="mt-1 text-sm text-muted">{nextShort.date}</p>
          </Card>
        ) : null}

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">This week</p>
              <p className="text-lg font-semibold">
                {completedThisWeek} / {Math.max(totalThisWeek, 1)} sessions completed
              </p>
            </div>
            <SecondaryButton
              className="!min-h-10 !px-3 !text-sm"
              onClick={() => router.push("/plan")}
            >
              View week
            </SecondaryButton>
          </div>
          <p className="mt-3 text-sm text-muted">
            Current focus: OAHS · Planche · Splits
          </p>
        </Card>
      </div>

      {showCheckin ? (
        <WellbeingModal
          onClose={() => setShowCheckin(false)}
          onSave={(data) => {
            saveWellbeing({ ...data, date: today });
            setShowCheckin(false);
          }}
        />
      ) : null}

      <MissedSessionPrompt />
      <ScheduleAdjustmentPreview />
    </div>
  );
}

function WellbeingModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (d: {
    sleep_quality_1_5: number;
    energy_1_5: number;
    soreness_0_10: number;
    neck_pain_0_10: number;
    back_pain_0_10: number;
    notes: string;
  }) => void;
}) {
  const [sleep, setSleep] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sore, setSore] = useState(2);
  const [neck, setNeck] = useState(0);
  const [back, setBack] = useState(0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
      <Card className="w-full max-w-md space-y-3">
        <h3 className="text-lg font-semibold">Daily readiness</h3>
        <Slider label="Sleep quality" min={1} max={5} value={sleep} onChange={setSleep} />
        <Slider label="Energy" min={1} max={5} value={energy} onChange={setEnergy} />
        <Slider label="Soreness" min={0} max={10} value={sore} onChange={setSore} />
        <Slider label="Neck pain" min={0} max={10} value={neck} onChange={setNeck} />
        <Slider label="Back pain" min={0} max={10} value={back} onChange={setBack} />
        <div className="flex gap-2 pt-2">
          <SecondaryButton className="flex-1" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            className="flex-1"
            onClick={() =>
              onSave({
                sleep_quality_1_5: sleep,
                energy_1_5: energy,
                soreness_0_10: sore,
                neck_pain_0_10: neck,
                back_pain_0_10: back,
                notes: "",
              })
            }
          >
            Save
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-semibold">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
    </label>
  );
}
