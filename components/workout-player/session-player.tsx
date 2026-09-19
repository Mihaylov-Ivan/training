"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getExerciseBySlug } from "@/lib/seed/exercises";
import { getRoutineById } from "@/lib/seed/routines";
import { useAppStore } from "@/lib/store/app-store";
import { estimateSessionDurationMin } from "@/lib/training/estimate-duration";
import { formatPrescription } from "@/lib/utils";
import type { Prescription } from "@/lib/types";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui/primitives";
import { RestTimer } from "@/components/workout-player/rest-timer";
import { ExerciseDrawer } from "@/components/workout-player/exercise-drawer";
import { CompletionPrompt } from "@/components/workout-player/completion-prompt";
import { useWakeLock } from "@/components/workout-player/use-wake-lock";

export function SessionPlayer({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const session = useAppStore((s) =>
    s.trainingSessions.find((t) => t.id === sessionId),
  );
  const sessionItems = useAppStore((s) => s.sessionItems);
  const setResults = useAppStore((s) => s.setResults);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const awaitingCompletion = useAppStore((s) => s.awaitingCompletion);
  const profile = useAppStore((s) => s.profile);
  const beginSession = useAppStore((s) => s.beginSession);
  const setOverviewSeen = useAppStore((s) => s.setOverviewSeen);
  const completeSet = useAppStore((s) => s.completeSet);
  const startWorkTimer = useAppStore((s) => s.startWorkTimer);
  const skipExercise = useAppStore((s) => s.skipExercise);
  const deferExerciseAfterNext = useAppStore((s) => s.deferExerciseAfterNext);
  const pauseSession = useAppStore((s) => s.pauseSession);
  const resumeSession = useAppStore((s) => s.resumeSession);
  const abandonSession = useAppStore((s) => s.abandonSession);
  const completeSession = useAppStore((s) => s.completeSession);
  const submitExerciseCompletion = useAppStore(
    (s) => s.submitExerciseCompletion,
  );

  const items = useMemo(
    () =>
      sessionItems
        .filter((i) => i.training_session_id === sessionId)
        .slice()
        .sort((a, b) => a.sequence - b.sequence),
    [sessionItems, sessionId],
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastPreview, setLastPreview] = useState<{
    preview: string;
    explanation: string;
  } | null>(null);
  const [skipPrompt, setSkipPrompt] = useState(false);
  const [skipMessage, setSkipMessage] = useState<string | null>(null);

  const current = useMemo(
    () =>
      items.find((i) => i.status === "active") ??
      items.find((i) => i.status === "pending"),
    [items],
  );
  const [actualReps, setActualReps] = useState<number | null>(
    current?.prescription_snapshot.reps_per_set ?? null,
  );

  useWakeLock(session?.status === "active" || session?.status === "resting");

  const sideProgress = useMemo(() => {
    if (!current) {
      return { setIndex: 1, side: null as "left" | "right" | null };
    }
    const total = current.prescription_snapshot.sets ?? 1;
    const rows = setResults.filter(
      (row) => row.session_item_id === current.id,
    );

    if (!current.prescription_snapshot.per_side) {
      return {
        setIndex: Math.min(rows.length + 1, total),
        side: null as "left" | "right" | null,
      };
    }

    for (let setIndex = 1; setIndex <= total; setIndex++) {
      const setRows = rows.filter((row) => row.set_index === setIndex);
      const hasBoth = setRows.some(
        (row) => row.actual.side === "both" || row.actual.side == null,
      );
      if (hasBoth) continue;
      if (!setRows.some((row) => row.actual.side === "left")) {
        return { setIndex, side: "left" as const };
      }
      if (!setRows.some((row) => row.actual.side === "right")) {
        return { setIndex, side: "right" as const };
      }
    }

    return { setIndex: total, side: "right" as const };
  }, [current, setResults]);

  const currentSetIndex = sideProgress.setIndex;
  const currentSide = sideProgress.side;
  const repsKey = `${current?.id ?? "none"}:${currentSetIndex}:${currentSide ?? "both"}:${current?.prescription_snapshot.reps_per_set ?? ""}`;
  const [prevRepsKey, setPrevRepsKey] = useState(repsKey);
  if (prevRepsKey !== repsKey) {
    setPrevRepsKey(repsKey);
    setActualReps(current?.prescription_snapshot.reps_per_set ?? null);
    setLastPreview(null);
  }

  useEffect(() => {
    setSkipPrompt(false);
    setSkipMessage(null);
  }, [current?.id]);

  if (!session) {
    return (
      <div className="p-6">
        <p>Session not found.</p>
        <SecondaryButton className="mt-4" onClick={() => router.push("/today")}>
          Back to Today
        </SecondaryButton>
      </div>
    );
  }

  const routine = getRoutineById(session.routine_template_id);
  const exercise = current ? getExerciseBySlug(current.exercise_slug) : null;
  const totalSets = current?.prescription_snapshot.sets ?? 1;
  const allDone = items.every((i) =>
    ["completed", "partial", "skipped", "pain_limited"].includes(i.status),
  );

  if (!session.overview_seen) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-8">
        <Badge tone="accent">
          {session.cycle_week === 4 ? "Deload · " : ""}
          Overview
        </Badge>
        <h1 className="mt-3 text-3xl font-semibold">{routine?.name}</h1>
        <p className="mt-2 text-muted">
          ~{estimateSessionDurationMin(items)} min est. · {items.length}{" "}
          exercises · Week {session.cycle_week}
        </p>
        <Card className="mt-6">
          <p className="text-sm font-medium">Focus order</p>
          <p className="mt-2 text-sm text-muted">{routine?.description}</p>
          <ol className="mt-4 max-h-48 space-y-1 overflow-auto text-sm">
            {items.slice(0, 12).map((i) => (
              <li key={i.id}>
                {i.sequence}. {i.exercise_name}
              </li>
            ))}
            {items.length > 12 ? (
              <li className="text-muted">…and {items.length - 12} more</li>
            ) : null}
          </ol>
        </Card>
        {session.readiness_snapshot &&
        (session.readiness_snapshot.neck_pain_0_10 >= 4 ||
          session.readiness_snapshot.back_pain_0_10 >= 4) ? (
          <Card className="mt-3 border-danger/40 bg-danger-soft/30">
            <p className="text-sm text-danger">
              Pain noted on readiness check-in. Progress carefully; freeze
              progression if pain ≥4/10.
            </p>
          </Card>
        ) : null}
        <PrimaryButton
          className="mt-auto w-full"
          onClick={() => {
            setOverviewSeen(sessionId);
            beginSession(sessionId);
          }}
        >
          Begin
        </PrimaryButton>
      </div>
    );
  }

  if (allDone || session.status === "completed") {
    return (
      <SessionSummaryInline
        sessionId={sessionId}
        onFinish={() => {
          completeSession(sessionId);
          router.push(`/session/${sessionId}/summary`);
        }}
      />
    );
  }

  if (!current) {
    return <p className="p-6">No exercises.</p>;
  }

  const timerActive =
    Boolean(activeTimer) &&
    activeTimer!.session_id === sessionId &&
    activeTimer!.session_item_id === current.id;

  const timedWork = workTimerSpec(current.prescription_snapshot);

  function logCompletedSet() {
    completeSet({
      sessionItemId: current!.id,
      setIndex: currentSetIndex,
      actual: {
        reps: actualReps ?? undefined,
        hold_seconds: current!.prescription_snapshot.hold_seconds ?? undefined,
        load_kg: current!.prescription_snapshot.load_kg ?? undefined,
        distance_m: current!.prescription_snapshot.distance_m ?? undefined,
        duration_seconds:
          current!.prescription_snapshot.duration_seconds ?? undefined,
        side: currentSide ?? "both",
      },
    });
  }

  return (
    <div className="safe-bottom safe-top mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden px-4 pb-3 pt-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          className="min-h-11 text-sm text-muted"
          onClick={() => {
            if (confirm("Leave session? Progress so far is saved.")) {
              router.push("/today");
            }
          }}
        >
          Exit
        </button>
        <div className="flex gap-2">
          {session.status === "paused" ? (
            <SecondaryButton
              className="!min-h-10 !px-3 !text-sm"
              onClick={() => resumeSession(sessionId)}
            >
              Resume
            </SecondaryButton>
          ) : (
            <SecondaryButton
              className="!min-h-10 !px-3 !text-sm"
              onClick={() => pauseSession(sessionId)}
            >
              Pause
            </SecondaryButton>
          )}
          <SecondaryButton
            className="!min-h-10 !px-3 !text-sm"
            onClick={() => {
              if (confirm("End session early?")) {
                abandonSession(sessionId);
                router.push("/today");
              }
            }}
          >
            End
          </SecondaryButton>
        </div>
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        Exercise {items.findIndex((i) => i.id === current.id) + 1} of{" "}
        {items.length} · {current.block}
      </p>
      <button
        className="mt-1 text-left text-2xl font-semibold leading-tight"
        onClick={() => setDrawerOpen(true)}
      >
        {current.exercise_name}
      </button>
      <p className="mt-2 text-sm text-muted">
        {formatPrescription(current.prescription_snapshot)}
        {current.prescription_snapshot.rest_seconds
          ? ` · ${current.prescription_snapshot.rest_seconds}s rest`
          : ""}
      </p>
      {current.prescription_snapshot.notes ? (
        <p className="mt-1 text-sm leading-snug text-muted">
          {current.prescription_snapshot.notes}
        </p>
      ) : null}
      {skipMessage ? (
        <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
          {skipMessage}
        </p>
      ) : null}
      {current.prescription_snapshot.per_side ? (
        <p className="mt-1 text-sm font-medium text-accent">
          Each side is logged separately. Complete both sides before the set rest.
        </p>
      ) : null}

      {timerActive ? (
        <RestTimer
          sound={profile?.timer_sound ?? true}
          haptics={profile?.timer_haptics ?? true}
          onWorkComplete={
            activeTimer!.kind === "hold" || activeTimer!.kind === "work"
              ? logCompletedSet
              : undefined
          }
        />
      ) : awaitingCompletion ? (
        <CompletionPrompt
          item={current}
          onSubmit={(payload) => {
            const res = submitExerciseCompletion({
              sessionItemId: current.id,
              completedAll: payload.completedAll,
              difficulty: payload.difficulty,
              painScore: payload.painScore,
              sharpPain: payload.sharpPain,
              metrics: payload.metrics,
              attemptsToComplete: payload.attemptsToComplete,
              problemLetter: String(
                current.prescription_snapshot.extras?.problem ?? "A",
              ),
            });
            setLastPreview(res);
          }}
        />
      ) : (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <p className="text-center text-sm text-muted">
            Set {Math.min(currentSetIndex, totalSets)} of {totalSets}
            {currentSide
              ? ` · ${currentSide === "left" ? "Left" : "Right"} side`
              : ""}
            {timedWork
              ? timedWork.kind === "hold"
                ? " · Hold"
                : " · Timed"
              : ""}
          </p>
          <p className="mt-2 text-center text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">
            {current.prescription_snapshot.hold_seconds != null &&
            current.prescription_snapshot.reps_per_set == null
              ? `${current.prescription_snapshot.hold_seconds}s`
              : current.prescription_snapshot.duration_seconds != null
                ? formatClock(current.prescription_snapshot.duration_seconds)
                : current.prescription_snapshot.distance_m != null &&
                    !current.prescription_snapshot.reps_per_set
                  ? `${current.prescription_snapshot.distance_m}m`
                  : (actualReps ??
                    current.prescription_snapshot.reps_per_set ??
                    "—")}
          </p>
          {current.prescription_snapshot.load_kg != null &&
          current.prescription_snapshot.load_kg > 0 ? (
            <p className="mt-2 text-center text-lg text-muted">
              +{current.prescription_snapshot.load_kg} kg
            </p>
          ) : null}
          {current.prescription_snapshot.exercise_level ? (
            <p className="mt-1 text-center text-sm text-muted">
              {String(current.prescription_snapshot.exercise_level).replace(
                /_/g,
                " ",
              )}
            </p>
          ) : null}

          {current.prescription_snapshot.reps_per_set != null ? (
            <div className="mt-6 flex items-center justify-center gap-4">
              <SecondaryButton
                aria-label="Decrease reps"
                onClick={() => setActualReps((r) => Math.max(0, (r ?? 0) - 1))}
              >
                −
              </SecondaryButton>
              <span className="text-sm text-muted">Actual reps</span>
              <SecondaryButton
                aria-label="Increase reps"
                onClick={() => setActualReps((r) => (r ?? 0) + 1)}
              >
                +
              </SecondaryButton>
            </div>
          ) : null}

          {lastPreview ? (
            <Card className="mt-6 border-success/30 bg-success-soft/20">
              <p className="text-sm font-medium text-success">Next time</p>
              <p className="mt-1 text-sm">{lastPreview.preview}</p>
              <p className="mt-1 text-xs text-muted">
                {lastPreview.explanation}
              </p>
            </Card>
          ) : null}

          {skipPrompt ? (
            <Card className="mt-auto border-warning/40">
              <p className="text-sm font-semibold">Why are you skipping this exercise?</p>
              <p className="mt-1 text-xs text-muted">
                If you cannot perform it, the app will use a safe configured substitute when one is available. A normal skip simply moves on and does not count as a failed progression.
              </p>
              <div className="mt-4 space-y-2">
                <PrimaryButton
                  className="w-full"
                  onClick={() => {
                    const result = skipExercise(current.id, "cannot_do");
                    setSkipPrompt(false);
                    setSkipMessage(
                      result.replaced && result.replacementName
                        ? `Replaced with ${result.replacementName}.`
                        : "No configured substitute was appropriate, so the exercise was skipped.",
                    );
                  }}
                >
                  I cannot do this exercise
                </PrimaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => {
                    skipExercise(current.id, "skip");
                    setSkipPrompt(false);
                  }}
                >
                  Skip and move on
                </SecondaryButton>
                <SecondaryButton
                  className="w-full"
                  onClick={() => setSkipPrompt(false)}
                >
                  Cancel
                </SecondaryButton>
              </div>
            </Card>
          ) : null}

          <div className={`${skipPrompt ? "hidden" : ""} mt-auto space-y-2 pt-5`}>
            {timedWork ? (
              <PrimaryButton
                className="w-full"
                disabled={session.status === "paused"}
                onClick={() => startWorkTimer(current.id)}
              >
                {timedWork.kind === "hold"
                  ? "Start hold timer"
                  : "Start timer"}
              </PrimaryButton>
            ) : (
              <PrimaryButton
                className="w-full"
                disabled={session.status === "paused"}
                onClick={logCompletedSet}
              >
                Complete set
              </PrimaryButton>
            )}
            {timedWork ? (
              <SecondaryButton
                className="w-full"
                disabled={session.status === "paused"}
                onClick={logCompletedSet}
              >
                Complete set without timer
              </SecondaryButton>
            ) : null}
            {items.some(
              (i) =>
                i.sequence > current.sequence &&
                (i.status === "pending" || i.status === "active"),
            ) ? (
              <SecondaryButton
                className="w-full"
                disabled={session.status === "paused"}
                onClick={() => deferExerciseAfterNext(current.id)}
              >
                Do after next exercise
              </SecondaryButton>
            ) : null}
            <SecondaryButton
              className="w-full"
              onClick={() => setSkipPrompt(true)}
            >
              Skip exercise
            </SecondaryButton>
          </div>
        </div>
      )}

      {drawerOpen && exercise ? (
        <ExerciseDrawer
          exercise={exercise}
          prescription={current.prescription_snapshot}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function workTimerSpec(
  p: Prescription,
): { seconds: number; kind: "hold" | "work" } | null {
  if (p.hold_seconds != null && p.hold_seconds > 0 && p.reps_per_set == null) {
    return { seconds: p.hold_seconds, kind: "hold" };
  }
  if (p.duration_seconds != null && p.duration_seconds > 0) {
    return { seconds: p.duration_seconds, kind: "work" };
  }
  return null;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SessionSummaryInline({
  sessionId,
  onFinish,
}: {
  sessionId: string;
  onFinish: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4">
      <p className="text-5xl">✓</p>
      <h1 className="mt-4 text-2xl font-semibold">Session complete</h1>
      <p className="mt-2 text-center text-muted">
        Review progression changes and undo if needed on the summary screen.
      </p>
      <PrimaryButton className="mt-8 w-full max-w-sm" onClick={onFinish}>
        View summary
      </PrimaryButton>
      <p className="sr-only">{sessionId}</p>
    </div>
  );
}
