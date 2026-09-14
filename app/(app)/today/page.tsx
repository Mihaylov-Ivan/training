"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { getRoutineById } from "@/lib/seed/routines";
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

export default function TodayPage() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const cycles = useAppStore((s) => s.cycles);
  const scheduled = useAppStore((s) => s.scheduledSessions);
  const trainingSessions = useAppStore((s) => s.trainingSessions);
  const wellbeing = useAppStore((s) => s.wellbeingCheckins);
  const startSessionFromScheduled = useAppStore((s) => s.startSessionFromScheduled);
  const startMaintenance = useAppStore((s) => s.startMaintenance);
  const saveWellbeing = useAppStore((s) => s.saveWellbeing);

  const today = todayISO();
  const cycle = cycles[0];
  const week = cycle ? cycleWeekForDate(cycle.start_date, today) : 1;
  const todaySched = scheduled.find((s) => s.date === today);
  const checkin = wellbeing.find((w) => w.date === today);
  const ready = readinessPercent(checkin ?? null);

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

  const completedThisWeek = weekSessions.filter((s) => s.status === "completed").length;
  const totalThisWeek = weekSessions.length;

  const overdue =
    todaySched &&
    todaySched.status === "scheduled" &&
    trainingSessions.every(
      (t) =>
        t.scheduled_session_id !== todaySched.id ||
        (t.status !== "completed" && t.status !== "active"),
    ) &&
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
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Daily maintenance
              </p>
              <h2 className="mt-1 text-lg font-semibold">5-minute mobility</h2>
              <p className="mt-1 text-sm text-muted">
                Neck + shoulders + spine + hips + ankles
              </p>
            </div>
            <Badge>5 min</Badge>
          </div>
          <PrimaryButton className="mt-4 w-full" onClick={launchMaintenance}>
            Start
          </PrimaryButton>
        </Card>

        {isSunday ? (
          <Card>
            <Badge tone="accent">Recovery Day</Badge>
            <h2 className="mt-2 text-xl font-semibold">Sunday recovery</h2>
            <p className="mt-1 text-sm text-muted">
              Maintenance only today. Optional easy walking is encouraged — no structured
              workout.
            </p>
          </Card>
        ) : todaySched && routine ? (
          <Card className="border-accent/30">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  Primary session
                  {overdue ? " · Overdue" : ""}
                </p>
                <h2 className="mt-1 text-xl font-semibold">{routine.name}</h2>
                <p className="mt-1 text-sm text-muted">{routine.description}</p>
              </div>
              <Badge tone={overdue ? "warning" : "accent"}>
                {formatDuration(routine.default_duration_min)}
              </Badge>
            </div>
            <PrimaryButton
              className="mt-4 w-full"
              onClick={() => launch(todaySched.id)}
            >
              Start workout
            </PrimaryButton>
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
