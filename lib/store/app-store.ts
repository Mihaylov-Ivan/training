"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ActiveTimer,
  ExerciseResult,
  MissOutcome,
  MissReason,
  SkipExerciseReason,
  OfflineMutation,
  OnboardingDraft,
  Profile,
  ProgressionEvent,
  ProgressionState,
  ScheduleAdjustmentProposal,
  ScheduledSession,
  SchedulePreferences,
  SessionItem,
  SetResult,
  TrainingCycle,
  TrainingPause,
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
import {
  buildFutureScheduleReset,
  CURRENT_SCHEDULE_RESET_VERSION,
} from "@/lib/training/schedule-reset";
import { normalizeScheduledSessions } from "@/lib/training/normalize-schedule";
import { applyMinBetweenSetRest } from "@/lib/training/rest";
import {
  buildExerciseSubstitution,
  transitionRestSeconds,
  WORK_TIMER_PREP_SECONDS,
} from "@/lib/training/session-transitions";
import {
  buildTrainingPause,
  detectPendingMissedSessions,
  markPastSessionsPending,
  recalculateSchedule,
} from "@/lib/training/adaptive-schedule";
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
  deleteScheduledSessionsByIds,
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

function mergeById<T extends { id: string }>(cloud: T[], local: T[]): T[] {
  const merged = new Map<string, T>();
  for (const row of cloud) merged.set(row.id, row);
  for (const row of local) merged.set(row.id, row);
  return [...merged.values()];
}

function mergeByKey<T>(
  cloud: T[],
  local: T[],
  key: (row: T) => string,
): T[] {
  const merged = new Map<string, T>();
  for (const row of cloud) merged.set(key(row), row);
  for (const row of local) merged.set(key(row), row);
  return [...merged.values()];
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
  trainingPause: TrainingPause | null;
  pendingMissedSessionId: string | null;
  pendingAdjustment: ScheduleAdjustmentProposal | null;
  /** review = end-of-day confirm; manual_miss = user tapped Mark missed */
  missPromptMode: "review" | "manual_miss" | null;
  lastSyncedAt: string | null;
  syncStatus: "idle" | "syncing" | "error" | "offline";

  setHydrated: (v: boolean) => void;
  setAuthUserId: (id: string | null) => void;
  hydrateFromCloud: (snapshot: import("@/lib/supabase/sync").CloudSnapshot) => void;
  /** Remap local onboarded data onto the authenticated user and push to cloud */
  adoptAuthUser: (userId: string) => void;
  completeOnboarding: (draft: OnboardingDraft) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  ensureSchedule: () => void;
  resetFutureSchedule: (
    fromDate?: string,
  ) => Promise<{ removed: number; scheduled: number }>;
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
  /** Start a countdown for a hold or timed (duration) set. */
  startWorkTimer: (sessionItemId: string) => void;
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
  skipExercise: (
    sessionItemId: string,
    reason: SkipExerciseReason,
  ) => { replaced: boolean; replacementName?: string };
  /** Swap current exercise with the next pending one (do it after). */
  deferExerciseAfterNext: (sessionItemId: string) => void;
  pauseSession: (sessionId: string) => void;
  resumeSession: (sessionId: string) => void;
  abandonSession: (sessionId: string) => void;
  completeSession: (sessionId: string) => void;
  scanPendingMissedSessions: () => void;
  beginManualMiss: (scheduledId: string) => void;
  cancelMissPrompt: () => void;
  resolveMissedSession: (opts: {
    scheduledId: string;
    outcome: MissOutcome;
    reason?: MissReason | null;
    injuryArea?: string | null;
    injuryExercise?: string | null;
    forceSkip?: boolean;
    manualTargetDate?: string | null;
  }) => ScheduleAdjustmentProposal | null;
  applyScheduleAdjustment: (proposal: ScheduleAdjustmentProposal) => void;
  dismissScheduleAdjustment: () => void;
  keepOriginalSchedule: (
    scheduledId: string,
    reason?: MissReason | null,
  ) => void;
  moveScheduledSession: (scheduledId: string, toDate: string) => void;
  skipScheduledSession: (
    scheduledId: string,
    reason?: MissReason | null,
  ) => void;
  resumeTrainingPause: () => void;
  undoProgression: (eventId: string) => void;
  exportData: () => string;
  resetDemo: () => void;
  pushToCloud: () => Promise<void>;
  pullFromCloud: () => Promise<void>;
  syncNow: () => Promise<void>;
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
  trainingPause: null as TrainingPause | null,
  pendingMissedSessionId: null as string | null,
  pendingAdjustment: null as ScheduleAdjustmentProposal | null,
  missPromptMode: null as "review" | "manual_miss" | null,
  lastSyncedAt: null as string | null,
  syncStatus: "idle" as "idle" | "syncing" | "error" | "offline",
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
        const local = get();
        const sameUser =
          local.profile?.user_id === snapshot.profile.user_id;

        // A new device/account can bootstrap from cloud. Once the same user has
        // local state, local rows are authoritative so an older cloud snapshot
        // can never visually roll back an input that has not uploaded yet.
        if (!sameUser || !local.profile?.onboarding_complete) {
          set({
            profile: snapshot.profile,
            schedulePrefs: snapshot.schedulePrefs,
            cycles: snapshot.cycles,
            scheduledSessions: normalizeScheduledSessions(
              snapshot.scheduledSessions,
            ),
            trainingSessions: snapshot.trainingSessions,
            sessionItems: snapshot.sessionItems,
            setResults: snapshot.setResults,
            exerciseResults: snapshot.exerciseResults,
            progressionStates: snapshot.progressionStates,
            progressionEvents: snapshot.progressionEvents,
            wellbeingCheckins: snapshot.wellbeingCheckins,
            cloudSyncError: null,
            authUserId: snapshot.profile.user_id,
          });
          return;
        }

        set({
          profile: local.profile,
          schedulePrefs: local.schedulePrefs
            ? {
                ...local.schedulePrefs,
                schedule_reset_version: Math.max(
                  local.schedulePrefs.schedule_reset_version ?? 0,
                  snapshot.schedulePrefs?.schedule_reset_version ?? 0,
                ),
              }
            : snapshot.schedulePrefs,
          cycles: mergeById(snapshot.cycles, local.cycles),
          scheduledSessions: normalizeScheduledSessions(
            mergeById(snapshot.scheduledSessions, local.scheduledSessions),
          ),
          trainingSessions: mergeById(
            snapshot.trainingSessions,
            local.trainingSessions,
          ),
          sessionItems: mergeById(snapshot.sessionItems, local.sessionItems),
          setResults: mergeById(snapshot.setResults, local.setResults),
          exerciseResults: mergeById(
            snapshot.exerciseResults,
            local.exerciseResults,
          ),
          progressionStates: mergeByKey(
            snapshot.progressionStates,
            local.progressionStates,
            (row) => `${row.scope_type}:${row.scope_id}`,
          ),
          progressionEvents: mergeById(
            snapshot.progressionEvents,
            local.progressionEvents,
          ),
          wellbeingCheckins: mergeByKey(
            snapshot.wellbeingCheckins,
            local.wellbeingCheckins,
            (row) => row.date,
          ),
          cloudSyncError: null,
          authUserId: snapshot.profile.user_id,
        });
      },

      adoptAuthUser: (userId) => {
        const s = get();
        if (!s.profile?.onboarding_complete) {
          set({ authUserId: userId });
          return;
        }
        const remap = <T extends { user_id: string }>(rows: T[]): T[] =>
          rows.map((r) => ({ ...r, user_id: userId }));

        const profile = { ...s.profile, user_id: userId };
        const schedulePrefs = s.schedulePrefs
          ? { ...s.schedulePrefs, user_id: userId }
          : null;
        const cycles = remap(s.cycles);
        const scheduledSessions = remap(
          normalizeScheduledSessions(s.scheduledSessions),
        );
        const trainingSessions = remap(s.trainingSessions);
        const progressionStates = remap(s.progressionStates);
        const progressionEvents = remap(s.progressionEvents);
        const wellbeingCheckins = remap(s.wellbeingCheckins);

        set({
          authUserId: userId,
          profile,
          schedulePrefs,
          cycles,
          scheduledSessions,
          trainingSessions,
          progressionStates,
          progressionEvents,
          wellbeingCheckins,
        });

        queueOrSync(async () => {
          await pushFullSnapshot({
            profile,
            schedulePrefs,
            cycles,
            scheduledSessions,
            trainingSessions,
            sessionItems: get().sessionItems,
            setResults: get().setResults,
            exerciseResults: get().exerciseResults,
            progressionStates,
            progressionEvents,
            wellbeingCheckins,
          });
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
          schedule_reset_version: CURRENT_SCHEDULE_RESET_VERSION,
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
          existing: normalizeScheduledSessions(scheduledSessions),
        });
        set({ scheduledSessions: next });
        queueOrSync(() => syncScheduledSessions(next));
      },

      resetFutureSchedule: async (fromDate = todayISO()) => {
        const state = get();
        const profile = state.profile;
        const cycle =
          state.cycles.find((candidate) => candidate.status === "active") ??
          state.cycles[0];
        if (!profile || !cycle) {
          return { removed: 0, scheduled: state.scheduledSessions.length };
        }

        const userId = currentUserId(get);
        const plan = buildFutureScheduleReset({
          userId,
          cycle,
          weekdayMap: state.schedulePrefs?.weekday_map,
          scheduledSessions: state.scheduledSessions,
          trainingSessions: state.trainingSessions,
          fromDate,
          weeksAhead: 6,
        });
        const nextPrefs: SchedulePreferences = {
          user_id: userId,
          weekday_map:
            state.schedulePrefs?.weekday_map ?? defaultWeekdayMap(),
          schedule_reset_version: CURRENT_SCHEDULE_RESET_VERSION,
        };

        if (
          isSupabaseConfigured() &&
          userId !== LOCAL_USER_ID
        ) {
          if (
            typeof navigator !== "undefined" &&
            !navigator.onLine
          ) {
            throw new Error(
              "Future schedule reset requires an internet connection so old cloud rows can be removed safely.",
            );
          }
          await deleteScheduledSessionsByIds(userId, plan.removedIds);
        }

        set({
          scheduledSessions: plan.scheduledSessions,
          schedulePrefs: nextPrefs,
          pendingAdjustment: null,
          pendingMissedSessionId: null,
          missPromptMode: null,
        });

        if (isSupabaseConfigured() && userId !== LOCAL_USER_ID) {
          await syncScheduledSessions(plan.scheduledSessions);
          await syncSchedulePrefs(nextPrefs);
        }

        return {
          removed: plan.removedIds.length,
          scheduled: plan.scheduledSessions.filter(
            (session) =>
              session.date >= fromDate &&
              session.status === "scheduled",
          ).length,
        };
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
        // Stamp create time so Today can attribute planned sessions to a day.
        session.started_at = new Date().toISOString();
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
        // Stamp create time so Today can attribute planned sessions to a day.
        session.started_at = new Date().toISOString();
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
        const perSide = item.prescription_snapshot.per_side === true;
        const existingForSet = get().setResults.filter(
          (row) =>
            row.session_item_id === sessionItemId &&
            row.set_index === setIndex,
        );
        const sides = new Set(
          existingForSet
            .map((row) => row.actual.side)
            .filter((side): side is "left" | "right" | "both" => Boolean(side)),
        );
        if (actual.side) sides.add(actual.side);
        const logicalSetComplete =
          !perSide ||
          sides.has("both") ||
          (sides.has("left") && sides.has("right"));
        const isLast = setIndex >= sets && logicalSetComplete;
        const restSec = applyMinBetweenSetRest(
          item.prescription_snapshot.rest_seconds ?? 0,
        );

        let activeTimer = get().activeTimer;
        let awaitingCompletion = get().awaitingCompletion;
        let sessionStatusPatch: Partial<TrainingSession> = {};

        if (!logicalSetComplete) {
          activeTimer = null;
          awaitingCompletion = false;
          sessionStatusPatch = { status: "active" };
        } else if (!isLast && startRest !== false && restSec > 0) {
          activeTimer = {
            session_id: item.training_session_id,
            session_item_id: sessionItemId,
            rest_started_at: new Date().toISOString(),
            rest_duration_seconds: restSec,
            rest_label:
              typeof item.prescription_snapshot.extras?.rest_label === "string"
                ? String(item.prescription_snapshot.extras.rest_label)
                : undefined,
            kind: "rest",
          };
          sessionStatusPatch = { status: "resting" };
        } else if (isLast) {
          activeTimer = null;
          awaitingCompletion = true;
          sessionStatusPatch = { status: "active" };
        }

        set((state) => ({
          setResults: [...state.setResults, result],
          activeTimer,
          awaitingCompletion,
          trainingSessions: state.trainingSessions.map((training) =>
            training.id === item.training_session_id
              ? { ...training, ...sessionStatusPatch }
              : training,
          ),
        }));
      },

      startWorkTimer: (sessionItemId) => {
        const item = get().sessionItems.find((i) => i.id === sessionItemId);
        if (!item) return;
        const p = item.prescription_snapshot;
        const hold = p.hold_seconds;
        const duration = p.duration_seconds;
        let seconds = 0;
        let kind: ActiveTimer["kind"] = "work";
        if (hold != null && hold > 0 && p.reps_per_set == null) {
          seconds = hold;
          kind = "hold";
        } else if (duration != null && duration > 0) {
          seconds = duration;
          kind = "work";
        } else {
          return;
        }
        set((s) => ({
          activeTimer: {
            session_id: item.training_session_id,
            session_item_id: sessionItemId,
            rest_started_at: new Date().toISOString(),
            rest_duration_seconds: seconds,
            prep_seconds: WORK_TIMER_PREP_SECONDS,
            kind,
          },
          trainingSessions: s.trainingSessions.map((t) =>
            t.id === item.training_session_id && t.status === "resting"
              ? { ...t, status: "active" }
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
        // Clearing a work/hold timer cancels the countdown without logging the set.
        // Clearing rest returns to active work.
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
        if (
          elapsed >=
          t.rest_duration_seconds + (t.prep_seconds ?? 0)
        ) {
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
                "front-lever-hold": "front_lever",
                "back-lever-hold": "back_lever",
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
            oahs_protocol:
              item.prescription_snapshot.extras?.oahs_protocol,
            lever_protocol:
              item.prescription_snapshot.extras?.lever_protocol,
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
        const transitionSeconds = next
          ? transitionRestSeconds(item, next)
          : 0;

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
          activeTimer:
            next && transitionSeconds > 0
              ? {
                  session_id: item.training_session_id,
                  session_item_id: next.id,
                  rest_started_at: new Date().toISOString(),
                  rest_duration_seconds: transitionSeconds,
                  rest_label:
                    item.block === "warmup" && next.block === "skill"
                      ? "Pre-skill recovery"
                      : item.block === "skill" && next.block === "skill"
                        ? "Skill recovery"
                        : "Exercise recovery",
                  kind: "rest" as const,
                }
              : null,
          trainingSessions: s.trainingSessions.map((training) =>
            training.id === item.training_session_id
              ? {
                  ...training,
                  status:
                    next && transitionSeconds > 0
                      ? ("resting" as const)
                      : ("active" as const),
                }
              : training,
          ),
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

      skipExercise: (sessionItemId, reason) => {
        const item = get().sessionItems.find((i) => i.id === sessionItemId);
        if (!item) return { replaced: false };

        if (reason === "cannot_do") {
          const replacement = buildExerciseSubstitution(item);
          if (replacement) {
            set((state) => ({
              awaitingCompletion: false,
              activeTimer: null,
              setResults: state.setResults.filter(
                (row) => row.session_item_id !== sessionItemId,
              ),
              sessionItems: state.sessionItems.map((row) =>
                row.id === sessionItemId
                  ? {
                      ...row,
                      ...replacement,
                      progression_rule_code: null,
                      progression_scope: null,
                      progression_state_snapshot: null,
                      status: "active" as const,
                    }
                  : row,
              ),
            }));

            const session = get().trainingSessions.find(
              (training) => training.id === item.training_session_id,
            );
            const latestItems = get().sessionItems.filter(
              (row) => row.training_session_id === item.training_session_id,
            );
            if (session) {
              queueOrSync(() =>
                syncTrainingSessionBundle({
                  session,
                  items: latestItems,
                  setResults: get().setResults.filter((setResult) =>
                    latestItems.some((row) => row.id === setResult.session_item_id),
                  ),
                }),
              );
            }
            return {
              replaced: true,
              replacementName: replacement.exercise_name,
            };
          }
        }

        const items = get()
          .sessionItems.filter(
            (row) => row.training_session_id === item.training_session_id,
          )
          .sort((a, b) => a.sequence - b.sequence);
        const idx = items.findIndex((row) => row.id === sessionItemId);
        const next = items[idx + 1];
        const restSeconds = next
          ? Math.max(15, transitionRestSeconds(item, next))
          : 0;

        set((state) => ({
          awaitingCompletion: false,
          activeTimer:
            next && restSeconds > 0
              ? {
                  session_id: item.training_session_id,
                  session_item_id: next.id,
                  rest_started_at: new Date().toISOString(),
                  rest_duration_seconds: restSeconds,
                  rest_label: "Exercise recovery",
                  kind: "rest" as const,
                }
              : null,
          trainingSessions: state.trainingSessions.map((training) =>
            training.id === item.training_session_id
              ? {
                  ...training,
                  status:
                    next && restSeconds > 0
                      ? ("resting" as const)
                      : ("active" as const),
                }
              : training,
          ),
          sessionItems: state.sessionItems.map((row) => {
            if (row.id === sessionItemId) return { ...row, status: "skipped" };
            if (next && row.id === next.id) return { ...row, status: "active" };
            return row;
          }),
          currentItemIndex: next ? idx + 1 : idx,
        }));

        const session = get().trainingSessions.find(
          (training) => training.id === item.training_session_id,
        );
        const latestItems = get().sessionItems.filter(
          (row) => row.training_session_id === item.training_session_id,
        );
        if (session) {
          queueOrSync(() =>
            syncTrainingSessionBundle({
              session,
              items: latestItems,
              setResults: get().setResults.filter((setResult) =>
                latestItems.some((row) => row.id === setResult.session_item_id),
              ),
            }),
          );
        }

        return { replaced: false };
      },

      deferExerciseAfterNext: (sessionItemId) => {
        const item = get().sessionItems.find((i) => i.id === sessionItemId);
        if (!item) return;
        const sessionItems = get().sessionItems.filter(
          (i) => i.training_session_id === item.training_session_id,
        );
        const ordered = [...sessionItems].sort((a, b) => a.sequence - b.sequence);
        const idx = ordered.findIndex((i) => i.id === sessionItemId);
        if (idx < 0) return;
        const next = ordered.slice(idx + 1).find(
          (i) => i.status === "pending" || i.status === "active",
        );
        if (!next) return;

        const currentSeq = item.sequence;
        const nextSeq = next.sequence;
        set((s) => ({
          awaitingCompletion: false,
          activeTimer: null,
          sessionItems: s.sessionItems.map((i) => {
            if (i.id === sessionItemId) {
              return { ...i, sequence: nextSeq, status: "pending" };
            }
            if (i.id === next.id) {
              return { ...i, sequence: currentSeq, status: "active" };
            }
            return i;
          }),
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
              ? {
                  ...sch,
                  status: "completed" as const,
                  completed_at: new Date().toISOString(),
                }
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

      scanPendingMissedSessions: () => {
        const today = todayISO();
        const pause = get().trainingPause;
        if (pause?.active) return;
        if (get().missPromptMode === "manual_miss") return;
        const previous = get().scheduledSessions;
        const marked = markPastSessionsPending(
          normalizeScheduledSessions(previous),
          today,
        );
        const pending = detectPendingMissedSessions(marked, today);
        const next =
          pending.find((s) =>
            [
              "strength_power",
              "athleticism_endurance",
              "calisthenics_volume",
              "climbing",
              "swim_performance",
              "swim_recovery",
              "boxing",
            ].includes(s.day_role),
          ) ?? pending[0];
        set({
          scheduledSessions: marked,
          pendingMissedSessionId: next?.id ?? null,
          missPromptMode: next ? "review" : null,
        });
        const changed = marked.some((s) => {
          const old = previous.find((p) => p.id === s.id);
          return !old || old.status !== s.status;
        });
        if (changed) {
          queueOrSync(() => syncScheduledSessions(marked));
        }
      },

      beginManualMiss: (scheduledId) => {
        const sessions = normalizeScheduledSessions(get().scheduledSessions);
        const target = sessions.find((s) => s.id === scheduledId);
        if (!target) return;
        if (
          target.status === "completed" ||
          target.status === "partially_completed" ||
          target.status === "missed" ||
          target.status === "skipped" ||
          target.status === "cancelled"
        ) {
          return;
        }
        const updated = sessions.map((s) =>
          s.id === scheduledId
            ? { ...s, status: "pending_missed_confirmation" as const }
            : s,
        );
        set({
          scheduledSessions: updated,
          pendingMissedSessionId: scheduledId,
          missPromptMode: "manual_miss",
          pendingAdjustment: null,
        });
      },

      cancelMissPrompt: () => {
        const id = get().pendingMissedSessionId;
        const mode = get().missPromptMode;
        if (mode === "manual_miss" && id) {
          // Revert pending status back to scheduled if user cancels manual miss
          set((s) => ({
            scheduledSessions: s.scheduledSessions.map((row) =>
              row.id === id && row.status === "pending_missed_confirmation"
                ? { ...row, status: "scheduled" as const }
                : row,
            ),
            pendingMissedSessionId: null,
            missPromptMode: null,
          }));
          return;
        }
        set({ pendingMissedSessionId: null, missPromptMode: null });
      },

      resolveMissedSession: ({
        scheduledId,
        outcome,
        reason = null,
        injuryArea = null,
        injuryExercise = null,
        forceSkip = false,
        manualTargetDate = null,
      }: {
        scheduledId: string;
        outcome: MissOutcome;
        reason?: MissReason | null;
        injuryArea?: string | null;
        injuryExercise?: string | null;
        forceSkip?: boolean;
        manualTargetDate?: string | null;
      }) => {
        const cycle = get().cycles[0];
        const sessions = normalizeScheduledSessions(get().scheduledSessions);
        const target = sessions.find((s) => s.id === scheduledId);
        if (!target || !cycle) return null;

        if (outcome === "completed" || outcome === "partially_completed") {
          const updated = sessions.map((s) =>
            s.id === scheduledId
              ? {
                  ...s,
                  status: outcome,
                  completed_at: new Date().toISOString(),
                  missed_reason: null,
                }
              : s,
          );
          set({
            scheduledSessions: updated,
            pendingMissedSessionId: null,
            missPromptMode: null,
            pendingAdjustment: null,
          });
          queueOrSync(() => syncScheduledSessions(updated));
          return null;
        }

        const proposal = recalculateSchedule({
          missedSession: target,
          upcomingSessions: sessions,
          cycle,
          reason,
          injuryArea,
          injuryExercise,
          forceSkip,
          manualTargetDate,
        });

        if (proposal.recommendation === "pause" && reason) {
          const streak = proposal.warnings.length; // approximate; engine embeds days via pause builder
          const pause = buildTrainingPause(
            reason,
            Math.max(1, streak),
            new Date().toISOString(),
          );
          // Prefer computing missed days from consecutive misses ending at target
          let missedDays = 1;
          for (let i = 1; i <= 21; i++) {
            const d = new Date(target.date + "T12:00:00");
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().slice(0, 10);
            const day = sessions.filter((s) => s.date === iso);
            if (
              day.length &&
              day.every((s) => s.status === "missed" || s.status === "skipped")
            ) {
              missedDays += 1;
            } else break;
          }
          set({
            trainingPause: buildTrainingPause(
              reason,
              missedDays,
              new Date().toISOString(),
            ),
            pendingAdjustment: proposal,
            pendingMissedSessionId: scheduledId,
          });
          void pause;
          return proposal;
        }

        // Minor skips apply immediately without preview
        if (
          proposal.recommendation === "skip_and_resume" &&
          proposal.moved_sessions.length === 0
        ) {
          set({
            scheduledSessions: proposal.updated_sessions,
            pendingMissedSessionId: null,
            missPromptMode: null,
            pendingAdjustment: null,
          });
          queueOrSync(() =>
            syncScheduledSessions(proposal.updated_sessions),
          );
          return proposal;
        }

        set({
          pendingAdjustment: proposal,
          pendingMissedSessionId: scheduledId,
          missPromptMode: get().missPromptMode ?? "review",
        });
        return proposal;
      },

      applyScheduleAdjustment: (proposal: ScheduleAdjustmentProposal) => {
        set({
          scheduledSessions: proposal.updated_sessions,
          pendingAdjustment: null,
          pendingMissedSessionId: null,
          missPromptMode: null,
          trainingPause:
            proposal.recommendation === "pause"
              ? get().trainingPause
              : get().trainingPause,
        });
        queueOrSync(() => syncScheduledSessions(proposal.updated_sessions));
      },

      dismissScheduleAdjustment: () => {
        set({ pendingAdjustment: null });
      },

      keepOriginalSchedule: (scheduledId, reason = null) => {
        const sessions = normalizeScheduledSessions(get().scheduledSessions);
        const updated = sessions.map((s) =>
          s.id === scheduledId
            ? {
                ...s,
                status: "missed" as const,
                missed_reason: reason,
              }
            : s,
        );
        set({
          scheduledSessions: updated,
          pendingAdjustment: null,
          pendingMissedSessionId: null,
          missPromptMode: null,
        });
        queueOrSync(() => syncScheduledSessions(updated));
      },

      moveScheduledSession: (scheduledId, toDate) => {
        const cycle = get().cycles[0];
        const sessions = normalizeScheduledSessions(get().scheduledSessions);
        const target = sessions.find((s) => s.id === scheduledId);
        if (!target || !cycle) return;
        const proposal = recalculateSchedule({
          missedSession: target,
          upcomingSessions: sessions,
          cycle,
          reason: target.missed_reason ?? "no_time",
          manualTargetDate: toDate,
        });
        // Mark as manually rescheduled on makeups
        const updated = proposal.updated_sessions.map((s) =>
          s.rescheduled_from_id === target.id
            ? { ...s, manually_rescheduled: true, auto_rescheduled: false }
            : s,
        );
        set({
          scheduledSessions: updated,
          pendingAdjustment: null,
          pendingMissedSessionId: null,
          missPromptMode: null,
        });
        queueOrSync(() => syncScheduledSessions(updated));
      },

      skipScheduledSession: (scheduledId, reason = null) => {
        const cycle = get().cycles[0];
        const sessions = normalizeScheduledSessions(get().scheduledSessions);
        const target = sessions.find((s) => s.id === scheduledId);
        if (!target || !cycle) return;
        const proposal = recalculateSchedule({
          missedSession: target,
          upcomingSessions: sessions,
          cycle,
          reason,
          forceSkip: true,
        });
        set({
          scheduledSessions: proposal.updated_sessions,
          pendingAdjustment: null,
          pendingMissedSessionId: null,
          missPromptMode: null,
        });
        queueOrSync(() => syncScheduledSessions(proposal.updated_sessions));
      },

      resumeTrainingPause: () => {
        const pause = get().trainingPause;
        if (!pause) {
          set({ trainingPause: null });
          return;
        }
        set({
          trainingPause: { ...pause, active: false },
        });
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
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          set({ syncStatus: "offline" });
          return;
        }
        set({ syncStatus: "syncing" });
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
          set({
            cloudSyncError: null,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: "idle",
            offlineQueue: [],
          });
        } catch (e) {
          set({
            cloudSyncError:
              e instanceof Error ? e.message : "Cloud sync failed",
            syncStatus: "error",
          });
          throw e;
        }
      },

      pullFromCloud: async () => {
        if (!isSupabaseConfigured()) return;
        const userId = get().authUserId ?? get().profile?.user_id;
        if (!userId || userId === LOCAL_USER_ID) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          set({ syncStatus: "offline" });
          return;
        }
        set({ syncStatus: "syncing" });
        try {
          const { loadCloudSnapshot } = await import("@/lib/supabase/sync");
          const cloud = await loadCloudSnapshot(userId);
          if (!cloud?.profile?.onboarding_complete && !cloud?.profile) {
            set({ syncStatus: "idle" });
            return;
          }
          if (!cloud?.profile) {
            set({ syncStatus: "idle" });
            return;
          }
          const preserve = {
            activeTimer: get().activeTimer,
            currentSessionId: get().currentSessionId,
            currentItemIndex: get().currentItemIndex,
            awaitingCompletion: get().awaitingCompletion,
          };
          get().hydrateFromCloud({
            ...cloud,
            profile: {
              ...cloud.profile,
              onboarding_complete:
                cloud.profile.onboarding_complete ||
                (cloud.progressionStates?.length ?? 0) > 0 ||
                (cloud.cycles?.length ?? 0) > 0,
            },
          });
          if (preserve.currentSessionId) {
            set({
              activeTimer: preserve.activeTimer,
              currentSessionId: preserve.currentSessionId,
              currentItemIndex: preserve.currentItemIndex,
              awaitingCompletion: preserve.awaitingCompletion,
            });
          }
          set({
            cloudSyncError: null,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: "idle",
          });
        } catch (e) {
          set({
            cloudSyncError:
              e instanceof Error ? e.message : "Cloud pull failed",
            syncStatus: "error",
          });
        }
      },

      syncNow: async () => {
        if (!isSupabaseConfigured() || !get().profile?.onboarding_complete) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          set({ syncStatus: "offline" });
          return;
        }
        // Push local first, then pull remote so other devices converge
        await get().pushToCloud();
        await get().pullFromCloud();
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
        lastSyncedAt: s.lastSyncedAt,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export { defaultWeekdayMap };
