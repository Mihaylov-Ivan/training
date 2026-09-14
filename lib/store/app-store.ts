"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ActiveTimer,
  ExerciseResult,
  OfflineMutation,
  OnboardingDraft,
  Profile,
  ProgressionEvent,
  ProgressionState,
  ScheduledSession,
  SchedulePreferences,
  SessionItem,
  SetResult,
  TrainingCycle,
  TrainingSession,
  WellbeingCheckin,
} from "@/lib/types";
import { LOCAL_USER_ID } from "@/lib/types";
import {
  createInitialProgressionStates,
  defaultWeekdayMap,
  todayISO,
  uid,
} from "@/lib/utils";
import {
  createActiveCycle,
  generateScheduledSessions,
} from "@/lib/training/schedule";
import { snapshotSession } from "@/lib/training/snapshot";
import { getRoutineById } from "@/lib/seed/routines";
import {
  evaluateProgression,
  undoProgressionEvent,
  type CompletionInput,
} from "@/lib/progression/engine";
import { clone } from "@/lib/utils";
import {
  pushFullSnapshot,
  queueOrSync,
  syncProgressionStates,
  syncProfile,
  syncSchedulePrefs,
  syncScheduledSessions,
  syncTrainingSessionBundle,
  syncWellbeing,
  syncCycles,
  type CloudSnapshot,
} from "@/lib/supabase/sync";
import { isSupabaseConfigured } from "@/lib/supabase/client";

function currentUserId(get: () => AppState): string {
  return get().authUserId ?? get().profile?.user_id ?? LOCAL_USER_ID;
}

export interface AppState {
  hydrated: boolean;
  authUserId: string | null;
  cloudSyncError: string | null;
  profile: Profile | null;
  schedulePrefs: SchedulePreferences | null;
  cycles: TrainingCycle[];
  scheduledSessions: ScheduledSession[];
  trainingSessions: TrainingSession[];
  sessionItems: SessionItem[];
  setResults: SetResult[];
  exerciseResults: ExerciseResult[];
  progressionStates: ProgressionState[];
  progressionEvents: ProgressionEvent[];
  wellbeingCheckins: WellbeingCheckin[];
  activeTimer: ActiveTimer | null;
  offlineQueue: OfflineMutation[];
  currentSessionId: string | null;
  currentItemIndex: number;
  awaitingCompletion: boolean;

  setHydrated: (v: boolean) => void;
  setAuthUserId: (id: string | null) => void;
  hydrateFromCloud: (snapshot: import("@/lib/supabase/sync").CloudSnapshot) => void;
  completeOnboarding: (draft: OnboardingDraft) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  ensureSchedule: () => void;
  saveWellbeing: (data: Omit<WellbeingCheckin, "id" | "user_id">) => void;
  startSessionFromScheduled: (scheduledId: string) => string;
  startMaintenance: () => string;
  beginSession: (sessionId: string) => void;
  setOverviewSeen: (sessionId: string) => void;
  completeSet: (opts: {
    sessionItemId: string;
    setIndex: number;
    actual: SetResult["actual"];
    startRest?: boolean;
  }) => void;
  adjustRest: (deltaSec: number) => void;
  skipRest: () => void;
  clearTimer: () => void;
  tickRestoreTimer: () => void;
  submitExerciseCompletion: (
    input: Omit<CompletionInput, "userId" | "ruleCode"> & {
      difficulty?: number | null;
      ruleCode?: string;
    },
  ) => { preview: string; explanation: string; eventId: string };
  skipExercise: (sessionItemId: string) => void;
  pauseSession: (sessionId: string) => void;
  resumeSession: (sessionId: string) => void;
  abandonSession: (sessionId: string) => void;
  completeSession: (sessionId: string) => void;
  undoProgression: (eventId: string) => void;
  exportData: () => string;
  resetDemo: () => void;
  pushToCloud: () => Promise<void>;
}

const empty = {
  authUserId: null as string | null,
  cloudSyncError: null as string | null,
  profile: null as Profile | null,
  schedulePrefs: null as SchedulePreferences | null,
  cycles: [] as TrainingCycle[],
  scheduledSessions: [] as ScheduledSession[],
  trainingSessions: [] as TrainingSession[],
  sessionItems: [] as SessionItem[],
  setResults: [] as SetResult[],
  exerciseResults: [] as ExerciseResult[],
  progressionStates: [] as ProgressionState[],
  progressionEvents: [] as ProgressionEvent[],
  wellbeingCheckins: [] as WellbeingCheckin[],
  activeTimer: null as ActiveTimer | null,
  offlineQueue: [] as OfflineMutation[],
  currentSessionId: null as string | null,
  currentItemIndex: 0,
  awaitingCompletion: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...empty,

      setHydrated: (v) => set({ hydrated: v }),

      setAuthUserId: (id) => set({ authUserId: id }),

      hydrateFromCloud: (snapshot: CloudSnapshot) => {
        if (!snapshot.profile) return;
        set({
          profile: snapshot.profile,
          schedulePrefs: snapshot.schedulePrefs,
          cycles: snapshot.cycles,
          scheduledSessions: snapshot.scheduledSessions,
          trainingSessions: snapshot.trainingSessions,
          sessionItems: snapshot.sessionItems,
          setResults: snapshot.setResults,
          exerciseResults: snapshot.exerciseResults,
          progressionStates: snapshot.progressionStates,
          progressionEvents: snapshot.progressionEvents,
          wellbeingCheckins: snapshot.wellbeingCheckins,
          cloudSyncError: null,
        });
      },

      completeOnboarding: (draft) => {
        const userId = currentUserId(get);
        const now = new Date().toISOString();
        const profile: Profile = {
          user_id: userId,
          display_name: "Athlete",
          units: draft.units,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          smallest_load_increment_kg: draft.smallest_load_increment_kg,
          pool_length_m: draft.pool_length_m,
          equipment: draft.equipment,
          onboarding_complete: true,
          timer_sound: true,
          timer_haptics: true,
          created_at: now,
          updated_at: now,
        };
        const schedulePrefs: SchedulePreferences = {
          user_id: userId,
          weekday_map: draft.weekday_map,
        };
        const cycle = createActiveCycle(userId);
        const scheduled = generateScheduledSessions({
          userId,
          cycle,
          weeksAhead: 6,
          weekdayMap: draft.weekday_map,
        });
        const progressionStates = createInitialProgressionStates(draft, userId);
        set({
          profile,
          schedulePrefs,
          cycles: [cycle],
          scheduledSessions: scheduled,
          progressionStates,
        });
        queueOrSync(async () => {
          await syncProfile(profile);
          await syncSchedulePrefs(schedulePrefs);
          await syncCycles([cycle]);
          await syncScheduledSessions(scheduled);
          await syncProgressionStates(progressionStates);
        });
      },

      updateProfile: (patch) => {
        const p = get().profile;
        if (!p) return;
        const next = {
          ...p,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        set({ profile: next });
        queueOrSync(() => syncProfile(next));
      },

      ensureSchedule: () => {
        const { cycles, scheduledSessions, schedulePrefs, profile } = get();
        if (!profile || !cycles[0]) return;
        const next = generateScheduledSessions({
          userId: currentUserId(get),
          cycle: cycles[0],
          weeksAhead: 6,
          weekdayMap: schedulePrefs?.weekday_map,
          existing: scheduledSessions,
        });
        set({ scheduledSessions: next });
        queueOrSync(() => syncScheduledSessions(next));
      },

      saveWellbeing: (data) => {
        const existing = get().wellbeingCheckins.filter((w) => w.date !== data.date);
        const row: WellbeingCheckin = {
          ...data,
          id: uid("wb"),
          user_id: currentUserId(get),
        };
        set({ wellbeingCheckins: [...existing, row] });
        queueOrSync(() => syncWellbeing(row));
      },

      startSessionFromScheduled: (scheduledId) => {
        const sched = get().scheduledSessions.find((s) => s.id === scheduledId);
        if (!sched) throw new Error("Scheduled session not found");
        const routine = getRoutineById(sched.routine_template_id);
        if (!routine) throw new Error("Routine not found");
        const { session, items } = snapshotSession({
          userId: currentUserId(get),
          routine,
          scheduledSessionId: sched.id,
          cycleWeek: sched.cycle_week,
          states: get().progressionStates,
          dayRole: sched.day_role,
        });
        const todayWb = get().wellbeingCheckins.find((w) => w.date === todayISO());
        session.readiness_snapshot = todayWb ?? null;
        set((s) => ({
          trainingSessions: [...s.trainingSessions, session],
          sessionItems: [...s.sessionItems, ...items],
          currentSessionId: session.id,
          currentItemIndex: 0,
          awaitingCompletion: false,
          activeTimer: null,
        }));
        queueOrSync(() =>
          syncTrainingSessionBundle({ session, items }),
        );
        return session.id;
      },

      startMaintenance: () => {
        const routine = getRoutineById("routine-maintenance");
        if (!routine) throw new Error("Maintenance routine missing");
        const cycle = get().cycles[0];
        const cw = (cycle
          ? ((Math.floor(
              (Date.now() - new Date(cycle.start_date + "T12:00:00").getTime()) /
                86400000 /
                7,
            ) %
              4) +
              1)
          : 1) as 1 | 2 | 3 | 4;
        const { session, items } = snapshotSession({
          userId: currentUserId(get),
          routine,
          scheduledSessionId: null,
          cycleWeek: cw,
          states: get().progressionStates,
        });
        set((s) => ({
          trainingSessions: [...s.trainingSessions, session],
          sessionItems: [...s.sessionItems, ...items],
          currentSessionId: session.id,
          currentItemIndex: 0,
          awaitingCompletion: false,
          activeTimer: null,
        }));
        queueOrSync(() => syncTrainingSessionBundle({ session, items }));
        return session.id;
      },

      beginSession: (sessionId) => {
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  status: "active",
                  started_at: t.started_at ?? new Date().toISOString(),
                }
              : t,
          ),
          sessionItems: s.sessionItems.map((i, idx, arr) => {
            const mine = arr.filter((x) => x.training_session_id === sessionId);
            const first = mine.sort((a, b) => a.sequence - b.sequence)[0];
            if (i.id === first?.id) return { ...i, status: "active" };
            return i;
          }),
        }));
        const session = get().trainingSessions.find((t) => t.id === sessionId);
        const items = get().sessionItems.filter(
          (i) => i.training_session_id === sessionId,
        );
        if (session) {
          queueOrSync(() => syncTrainingSessionBundle({ session, items }));
        }
      },

      setOverviewSeen: (sessionId) => {
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId ? { ...t, overview_seen: true } : t,
          ),
        }));
      },

      completeSet: ({ sessionItemId, setIndex, actual, startRest }) => {
        const item = get().sessionItems.find((i) => i.id === sessionItemId);
        if (!item) return;
        const result: SetResult = {
          id: uid("set"),
          session_item_id: sessionItemId,
          set_index: setIndex,
          prescribed: item.prescription_snapshot,
          actual,
          started_at: null,
          completed_at: new Date().toISOString(),
          success: true,
          note: "",
        };
        const sets = item.prescription_snapshot.sets ?? 1;
        const isLast = setIndex >= sets;
        const restSec = item.prescription_snapshot.rest_seconds ?? 0;
        let activeTimer = get().activeTimer;
        let awaitingCompletion = get().awaitingCompletion;
        let sessionStatusPatch: Partial<TrainingSession> = {};

        if (!isLast && startRest !== false && restSec > 0) {
          activeTimer = {
            session_id: item.training_session_id,
            session_item_id: sessionItemId,
            rest_started_at: new Date().toISOString(),
            rest_duration_seconds: restSec,
            kind: "rest",
          };
          sessionStatusPatch = { status: "resting" };
        } else if (isLast) {
          activeTimer = null;
          awaitingCompletion = true;
        }

        set((s) => ({
          setResults: [...s.setResults, result],
          activeTimer,
          awaitingCompletion,
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === item.training_session_id
              ? { ...t, ...sessionStatusPatch, status: (sessionStatusPatch.status as TrainingSession["status"]) ?? (t.status === "resting" ? "active" : t.status) }
              : t,
          ),
        }));
      },

      adjustRest: (deltaSec) => {
        const t = get().activeTimer;
        if (!t) return;
        set({
          activeTimer: {
            ...t,
            rest_duration_seconds: Math.max(0, t.rest_duration_seconds + deltaSec),
          },
        });
      },

      skipRest: () => {
        const t = get().activeTimer;
        if (!t) return;
        set((s) => ({
          activeTimer: null,
          trainingSessions: s.trainingSessions.map((sess) =>
            sess.id === t.session_id && sess.status === "resting"
              ? { ...sess, status: "active" }
              : sess,
          ),
        }));
      },

      clearTimer: () => set({ activeTimer: null }),

      tickRestoreTimer: () => {
        const t = get().activeTimer;
        if (!t) return;
        const elapsed =
          (Date.now() - new Date(t.rest_started_at).getTime()) / 1000;
        if (elapsed >= t.rest_duration_seconds) {
          // leave timer for UI to show "Start next set"; don't auto-clear
        }
      },

      submitExerciseCompletion: (input) => {
        const item = get().sessionItems.find((i) => i.id === input.sessionItemId);
        if (!item) throw new Error("Item not found");
        const ruleCode =
          input.ruleCode ??
          item.progression_rule_code ??
          "MOBILITY_MAINTAIN_V1";
        const scopeId =
          item.progression_scope === "global_skill"
            ? ({
                "oahs-practice": "oahs",
                "planche-hold": "planche",
                "one-leg-human-flag": "human_flag",
                "front-split": "front_split",
                "middle-split": "middle_split",
              }[item.exercise_slug] ?? item.exercise_slug)
            : item.progression_scope === "capability"
              ? ({
                  "strong-easy-intervals": "run_intervals",
                  "steady-continuous-run": "run_steady",
                  "easy-continuous-run": "run_long",
                  "strong-controlled-freestyle": "swim_performance",
                  "climbing-quality-attempt": "climb_quality",
                  "continuous-easy-climbing": "climb_endurance",
                }[item.exercise_slug] ?? item.exercise_slug)
              : item.exercise_slug;

        let state = get().progressionStates.find(
          (p) =>
            p.scope_id === scopeId &&
            (item.progression_scope
              ? p.scope_type === item.progression_scope
              : true),
        );

        if (!state) {
          state = {
            id: uid("ps"),
          user_id: currentUserId(get),
          scope_type: item.progression_scope ?? "routine_item",
          scope_id: scopeId,
          current_level: null,
          state: {},
          success_credits: 0,
          consecutive_successes: 0,
          consecutive_failures: 0,
          updated_at: new Date().toISOString(),
        };
      }

      const result = evaluateProgression(state, {
          ...input,
          ruleCode,
          userId: currentUserId(get),
          metrics: {
            ...input.metrics,
            protocol: item.prescription_snapshot.protocol,
          },
          flagContext:
            item.prescription_snapshot.extras?.flag_context === "saturday"
              ? "saturday"
              : "monday",
        });

        const er: ExerciseResult = {
          id: uid("er"),
          session_item_id: item.id,
          completed_all: input.completedAll,
          difficulty: input.difficulty ?? null,
          pain_score: input.painScore ?? null,
          sharp_pain: input.sharpPain ?? false,
          note: "",
          metrics: input.metrics ?? {},
          idempotency_key: input.sessionItemId + ":" + ruleCode,
        };

        const items = get().sessionItems.filter(
          (i) => i.training_session_id === item.training_session_id,
        );
        const sorted = [...items].sort((a, b) => a.sequence - b.sequence);
        const idx = sorted.findIndex((i) => i.id === item.id);
        const next = sorted[idx + 1];

        set((s) => ({
          exerciseResults: [
            ...s.exerciseResults.filter((e) => e.idempotency_key !== er.idempotency_key),
            er,
          ],
          progressionStates: s.progressionStates.some((p) => p.id === result.state.id)
            ? s.progressionStates.map((p) =>
                p.id === result.state.id ? result.state : p,
              )
            : [...s.progressionStates, result.state],
          progressionEvents: [...s.progressionEvents, result.event],
          awaitingCompletion: false,
          activeTimer: null,
          sessionItems: s.sessionItems.map((i) => {
            if (i.id === item.id) {
              return {
                ...i,
                status: result.frozen
                  ? "pain_limited"
                  : input.completedAll
                    ? "completed"
                    : "partial",
              };
            }
            if (next && i.id === next.id) return { ...i, status: "active" };
            return i;
          }),
          currentItemIndex: next ? idx + 1 : idx,
          offlineQueue:
            typeof navigator !== "undefined" && !navigator.onLine
              ? [
                  ...s.offlineQueue,
                  {
                    id: uid("oq"),
                    created_at: new Date().toISOString(),
                    type: "exercise_completion",
                    payload: input,
                    idempotency_key: er.idempotency_key,
                  },
                ]
              : s.offlineQueue,
        }));

        const session = get().trainingSessions.find(
          (t) => t.id === item.training_session_id,
        );
        const latestItems = get().sessionItems.filter(
          (i) => i.training_session_id === item.training_session_id,
        );
        const latestSets = get().setResults.filter((r) =>
          latestItems.some((i) => i.id === r.session_item_id),
        );
        if (session) {
          queueOrSync(async () => {
            await syncTrainingSessionBundle({
              session,
              items: latestItems,
              setResults: latestSets,
              exerciseResults: [er],
              events: [result.event],
            });
            await syncProgressionStates([result.state]);
          });
        }

        return {
          preview: result.nextPrescriptionPreview,
          explanation: result.event.explanation,
          eventId: result.event.id,
        };
      },

      skipExercise: (sessionItemId) => {
        const item = get().sessionItems.find((i) => i.id === sessionItemId);
        if (!item) return;
        const items = get()
          .sessionItems.filter((i) => i.training_session_id === item.training_session_id)
          .sort((a, b) => a.sequence - b.sequence);
        const idx = items.findIndex((i) => i.id === sessionItemId);
        const next = items[idx + 1];
        set((s) => ({
          awaitingCompletion: false,
          activeTimer: null,
          sessionItems: s.sessionItems.map((i) => {
            if (i.id === sessionItemId) return { ...i, status: "skipped" };
            if (next && i.id === next.id) return { ...i, status: "active" };
            return i;
          }),
          currentItemIndex: next ? idx + 1 : idx,
        }));
      },

      pauseSession: (sessionId) => {
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId ? { ...t, status: "paused" } : t,
          ),
        }));
      },

      resumeSession: (sessionId) => {
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId ? { ...t, status: "active" } : t,
          ),
        }));
      },

      abandonSession: (sessionId) => {
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  status: "abandoned",
                  ended_at: new Date().toISOString(),
                }
              : t,
          ),
          activeTimer: null,
          awaitingCompletion: false,
          currentSessionId: null,
        }));
      },

      completeSession: (sessionId) => {
        const session = get().trainingSessions.find((t) => t.id === sessionId);
        set((s) => ({
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  status: "completed",
                  ended_at: new Date().toISOString(),
                }
              : t,
          ),
          scheduledSessions: s.scheduledSessions.map((sch) =>
            session?.scheduled_session_id &&
            sch.id === session.scheduled_session_id
              ? { ...sch, status: "completed" }
              : sch,
          ),
          activeTimer: null,
          awaitingCompletion: false,
        }));
        const updated = get().trainingSessions.find((t) => t.id === sessionId);
        const items = get().sessionItems.filter(
          (i) => i.training_session_id === sessionId,
        );
        if (updated) {
          queueOrSync(async () => {
            await syncTrainingSessionBundle({ session: updated, items });
            if (updated.scheduled_session_id) {
              const sch = get().scheduledSessions.find(
                (s) => s.id === updated.scheduled_session_id,
              );
              if (sch) await syncScheduledSessions([sch]);
            }
          });
        }
      },

      undoProgression: (eventId) => {
        const event = get().progressionEvents.find((e) => e.id === eventId);
        if (!event || event.undone_at) return;
        const item = get().sessionItems.find((i) => i.id === event.session_item_id);
        set((s) => ({
          progressionEvents: s.progressionEvents.map((e) =>
            e.id === eventId
              ? { ...e, undone_at: new Date().toISOString() }
              : e,
          ),
          progressionStates: s.progressionStates.map((ps) => {
            const afterMatch =
              JSON.stringify(ps.state) === JSON.stringify(event.after);
            if (!afterMatch) return ps;
            // Prefer matching the item's progression scope when possible
            if (item?.progression_scope && ps.scope_type !== item.progression_scope) {
              // still allow if after matches uniquely
            }
            return undoProgressionEvent(ps, event);
          }),
        }));
      },

      exportData: () => {
        const s = get();
        return JSON.stringify(
          {
            profile: s.profile,
            schedulePrefs: s.schedulePrefs,
            cycles: s.cycles,
            scheduledSessions: s.scheduledSessions,
            trainingSessions: s.trainingSessions,
            sessionItems: s.sessionItems,
            setResults: s.setResults,
            exerciseResults: s.exerciseResults,
            progressionStates: s.progressionStates,
            progressionEvents: s.progressionEvents,
            wellbeingCheckins: s.wellbeingCheckins,
          },
          null,
          2,
        );
      },

      resetDemo: () => {
        set({ ...clone(empty), hydrated: true, authUserId: get().authUserId });
      },

      pushToCloud: async () => {
        if (!isSupabaseConfigured() || !get().profile) return;
        try {
          await pushFullSnapshot({
            profile: get().profile,
            schedulePrefs: get().schedulePrefs,
            cycles: get().cycles,
            scheduledSessions: get().scheduledSessions,
            trainingSessions: get().trainingSessions,
            sessionItems: get().sessionItems,
            setResults: get().setResults,
            exerciseResults: get().exerciseResults,
            progressionStates: get().progressionStates,
            progressionEvents: get().progressionEvents,
            wellbeingCheckins: get().wellbeingCheckins,
          });
          set({ cloudSyncError: null });
        } catch (e) {
          set({
            cloudSyncError:
              e instanceof Error ? e.message : "Cloud sync failed",
          });
          throw e;
        }
      },
    }),
    {
      name: "lifetime-athlete-v1",
      partialize: (s) => ({
        authUserId: s.authUserId,
        profile: s.profile,
        schedulePrefs: s.schedulePrefs,
        cycles: s.cycles,
        scheduledSessions: s.scheduledSessions,
        trainingSessions: s.trainingSessions,
        sessionItems: s.sessionItems,
        setResults: s.setResults,
        exerciseResults: s.exerciseResults,
        progressionStates: s.progressionStates,
        progressionEvents: s.progressionEvents,
        wellbeingCheckins: s.wellbeingCheckins,
        activeTimer: s.activeTimer,
        offlineQueue: s.offlineQueue,
        currentSessionId: s.currentSessionId,
        currentItemIndex: s.currentItemIndex,
        awaitingCompletion: s.awaitingCompletion,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export { defaultWeekdayMap };
