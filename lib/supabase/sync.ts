"use client";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { normalizeScheduledSessions } from "@/lib/training/normalize-schedule";
import type {
  Profile,
  ProgressionEvent,
  ProgressionState,
  ScheduledSession,
  SchedulePreferences,
  SessionItem,
  SetResult,
  ExerciseResult,
  TrainingCycle,
  TrainingSession,
  WellbeingCheckin,
} from "@/lib/types";

export async function getAuthUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

export async function syncProfile(profile: Profile) {
  const supabase = createClient();
  const { error } = await supabase.from("profiles").upsert({
    user_id: profile.user_id,
    display_name: profile.display_name,
    units: profile.units,
    timezone: profile.timezone,
    smallest_load_increment_kg: profile.smallest_load_increment_kg,
    pool_length_m: profile.pool_length_m,
    equipment: profile.equipment,
    onboarding_complete: profile.onboarding_complete,
    timer_sound: profile.timer_sound,
    timer_haptics: profile.timer_haptics,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  });
  if (error) throw error;
}

export async function syncSchedulePrefs(prefs: SchedulePreferences) {
  const supabase = createClient();
  const { error } = await supabase.from("user_schedule_preferences").upsert(
    {
      user_id: prefs.user_id,
      weekday_map: prefs.weekday_map,
      reminder_preferences: {},
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function syncCycles(cycles: TrainingCycle[]) {
  if (cycles.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.from("training_cycles").upsert(
    cycles.map((c) => ({
      id: c.id,
      user_id: c.user_id,
      cycle_number: c.cycle_number,
      start_date: c.start_date,
      end_date: c.end_date,
      status: c.status,
    })),
  );
  if (error) throw error;
}

export async function syncScheduledSessions(rows: ScheduledSession[]) {
  if (rows.length === 0) return;
  const supabase = createClient();
  // Chunk to avoid payload limits
  const chunk = 100;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.from("scheduled_sessions").upsert(
      slice.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        date: s.date,
        original_date: s.original_date ?? s.date,
        routine_template_id: s.routine_template_id,
        cycle_week: s.cycle_week,
        cycle_number: s.cycle_number ?? 1,
        day_role: s.day_role,
        status: s.status,
        generated_from_schedule: s.generated_from_schedule,
        completed_at: s.completed_at,
        reschedule_count: s.reschedule_count ?? 0,
        missed_reason: s.missed_reason,
        sequence_index: s.sequence_index ?? 0,
        is_deload: s.is_deload ?? s.cycle_week === 4,
        auto_rescheduled: s.auto_rescheduled ?? false,
        manually_rescheduled: s.manually_rescheduled ?? false,
        rescheduled_from_id: s.rescheduled_from_id,
        missed_note: s.missed_note,
        injury_area: s.injury_area,
        injury_exercise: s.injury_exercise,
      })),
    );
    if (error) throw error;
  }
}

export async function syncProgressionStates(rows: ProgressionState[]) {
  if (rows.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.from("progression_states").upsert(
    rows.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      scope_type: p.scope_type,
      scope_id: p.scope_id,
      current_level: p.current_level,
      state: p.state,
      success_credits: p.success_credits,
      consecutive_successes: p.consecutive_successes,
      consecutive_failures: p.consecutive_failures,
      updated_at: p.updated_at,
    })),
    { onConflict: "user_id,scope_type,scope_id" },
  );
  if (error) throw error;
}

export async function syncTrainingSessionBundle(opts: {
  session: TrainingSession;
  items: SessionItem[];
  setResults?: SetResult[];
  exerciseResults?: ExerciseResult[];
  events?: ProgressionEvent[];
}) {
  const supabase = createClient();
  const { session, items } = opts;

  const { error: sErr } = await supabase.from("training_sessions").upsert({
    id: session.id,
    user_id: session.user_id,
    scheduled_session_id: session.scheduled_session_id,
    routine_template_id: session.routine_template_id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    status: session.status,
    readiness_snapshot: session.readiness_snapshot,
    notes: session.notes,
    cycle_week: session.cycle_week,
    overview_seen: session.overview_seen,
  });
  if (sErr) throw sErr;

  if (items.length) {
    const { error } = await supabase.from("session_items").upsert(
      items.map((i) => ({
        id: i.id,
        training_session_id: i.training_session_id,
        routine_item_id: i.routine_item_id,
        exercise_id: i.exercise_id,
        exercise_slug: i.exercise_slug,
        exercise_name: i.exercise_name,
        sequence: i.sequence,
        block: i.block,
        prescription_snapshot: i.prescription_snapshot,
        progression_state_snapshot: i.progression_state_snapshot,
        progression_rule_code: i.progression_rule_code,
        progression_scope: i.progression_scope,
        status: i.status,
      })),
    );
    if (error) throw error;
  }

  if (opts.setResults?.length) {
    const { error } = await supabase.from("set_results").upsert(
      opts.setResults.map((r) => ({
        id: r.id,
        session_item_id: r.session_item_id,
        set_index: r.set_index,
        prescribed: r.prescribed,
        actual: r.actual,
        started_at: r.started_at,
        completed_at: r.completed_at,
        success: r.success,
        note: r.note,
      })),
    );
    if (error) throw error;
  }

  if (opts.exerciseResults?.length) {
    const { error } = await supabase.from("exercise_results").upsert(
      opts.exerciseResults.map((r) => ({
        id: r.id,
        session_item_id: r.session_item_id,
        completed_all: r.completed_all,
        difficulty: r.difficulty,
        pain_score: r.pain_score,
        note: r.note,
        metrics: r.metrics,
        idempotency_key: r.idempotency_key,
      })),
      { onConflict: "idempotency_key" },
    );
    if (error) throw error;
  }

  if (opts.events?.length) {
    const { error } = await supabase.from("progression_events").upsert(
      opts.events.map((e) => ({
        id: e.id,
        user_id: e.user_id,
        session_item_id: e.session_item_id,
        rule_code: e.rule_code,
        event_type: e.event_type,
        before: e.before,
        after: e.after,
        explanation: e.explanation,
        next_prescription_preview: e.next_prescription_preview,
        created_at: e.created_at,
        undone_at: e.undone_at,
      })),
    );
    if (error) throw error;
  }
}

export async function syncWellbeing(row: WellbeingCheckin) {
  const supabase = createClient();
  const { error } = await supabase.from("wellbeing_checkins").upsert(
    {
      id: row.id,
      user_id: row.user_id,
      date: row.date,
      sleep_quality_1_5: row.sleep_quality_1_5,
      energy_1_5: row.energy_1_5,
      soreness_0_10: row.soreness_0_10,
      neck_pain_0_10: row.neck_pain_0_10,
      back_pain_0_10: row.back_pain_0_10,
      notes: row.notes,
    },
    { onConflict: "user_id,date" },
  );
  if (error) throw error;
}

export async function syncProgressionEvent(event: ProgressionEvent) {
  const supabase = createClient();
  const { error } = await supabase.from("progression_events").upsert({
    id: event.id,
    user_id: event.user_id,
    session_item_id: event.session_item_id,
    rule_code: event.rule_code,
    event_type: event.event_type,
    before: event.before,
    after: event.after,
    explanation: event.explanation,
    next_prescription_preview: event.next_prescription_preview,
    created_at: event.created_at,
    undone_at: event.undone_at,
  });
  if (error) throw error;
}

export type CloudSnapshot = {
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
};

export async function loadCloudSnapshot(
  userId: string,
): Promise<CloudSnapshot | null> {
  const supabase = createClient();

  const [
    profileRes,
    prefsRes,
    cyclesRes,
    schedRes,
    sessionsRes,
    statesRes,
    eventsRes,
    wbRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_schedule_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("training_cycles").select("*").eq("user_id", userId),
    supabase.from("scheduled_sessions").select("*").eq("user_id", userId),
    supabase.from("training_sessions").select("*").eq("user_id", userId),
    supabase.from("progression_states").select("*").eq("user_id", userId),
    supabase.from("progression_events").select("*").eq("user_id", userId),
    supabase.from("wellbeing_checkins").select("*").eq("user_id", userId),
  ]);

  if (profileRes.error) throw profileRes.error;

  const sessions = (sessionsRes.data ?? []) as TrainingSession[];
  const sessionIds = sessions.map((s) => s.id);

  let sessionItems: SessionItem[] = [];
  let setResults: SetResult[] = [];
  let exerciseResults: ExerciseResult[] = [];

  if (sessionIds.length) {
    const itemsRes = await supabase
      .from("session_items")
      .select("*")
      .in("training_session_id", sessionIds);
    if (itemsRes.error) throw itemsRes.error;
    sessionItems = (itemsRes.data ?? []).map((row) => ({
      id: row.id,
      training_session_id: row.training_session_id,
      routine_item_id: row.routine_item_id ?? "",
      exercise_id: row.exercise_id,
      exercise_slug: row.exercise_slug ?? String(row.exercise_id),
      exercise_name: row.exercise_name ?? String(row.exercise_id),
      sequence: row.sequence,
      block: row.block ?? "warmup",
      prescription_snapshot: row.prescription_snapshot,
      progression_state_snapshot: row.progression_state_snapshot,
      progression_rule_code: row.progression_rule_code,
      progression_scope: row.progression_scope,
      status: row.status,
    })) as SessionItem[];

    const itemIds = sessionItems.map((i) => i.id);
    if (itemIds.length) {
      const [setsRes, erRes] = await Promise.all([
        supabase.from("set_results").select("*").in("session_item_id", itemIds),
        supabase
          .from("exercise_results")
          .select("*")
          .in("session_item_id", itemIds),
      ]);
      if (setsRes.error) throw setsRes.error;
      if (erRes.error) throw erRes.error;
      setResults = (setsRes.data ?? []) as SetResult[];
      exerciseResults = (erRes.data ?? []).map((r) => ({
        ...r,
        sharp_pain: false,
      })) as ExerciseResult[];
    }
  }

  const profile = profileRes.data
    ? ({
        user_id: profileRes.data.user_id,
        display_name: profileRes.data.display_name,
        units: profileRes.data.units,
        timezone: profileRes.data.timezone,
        smallest_load_increment_kg: Number(
          profileRes.data.smallest_load_increment_kg,
        ),
        pool_length_m: profileRes.data.pool_length_m,
        equipment: profileRes.data.equipment,
        onboarding_complete: profileRes.data.onboarding_complete,
        timer_sound: profileRes.data.timer_sound,
        timer_haptics: profileRes.data.timer_haptics,
        created_at: profileRes.data.created_at,
        updated_at: profileRes.data.updated_at,
      } as Profile)
    : null;

  return {
    profile,
    schedulePrefs: prefsRes.data
      ? {
          user_id: prefsRes.data.user_id,
          weekday_map: prefsRes.data.weekday_map,
        }
      : null,
    cycles: (cyclesRes.data ?? []) as TrainingCycle[],
    scheduledSessions: normalizeScheduledSessions(
      (schedRes.data ?? []) as ScheduledSession[],
    ),
    trainingSessions: sessions.map((s) => ({
      ...s,
      cycle_week: (s as TrainingSession).cycle_week ?? 1,
      overview_seen: (s as TrainingSession).overview_seen ?? false,
    })),
    sessionItems,
    setResults,
    exerciseResults,
    progressionStates: (statesRes.data ?? []).map((p) => ({
      id: p.id,
      user_id: p.user_id,
      scope_type: p.scope_type,
      scope_id: p.scope_id,
      current_level: p.current_level ?? null,
      state: p.state,
      success_credits: p.success_credits,
      consecutive_successes: p.consecutive_successes,
      consecutive_failures: p.consecutive_failures,
      updated_at: p.updated_at,
    })) as ProgressionState[],
    progressionEvents: (eventsRes.data ?? []).map((e) => ({
      id: e.id,
      user_id: e.user_id,
      session_item_id: e.session_item_id,
      rule_code: e.rule_code ?? "",
      event_type: e.event_type,
      before: e.before,
      after: e.after,
      explanation: e.explanation ?? "",
      next_prescription_preview: e.next_prescription_preview ?? "",
      created_at: e.created_at,
      undone_at: e.undone_at,
    })) as ProgressionEvent[],
    wellbeingCheckins: (wbRes.data ?? []) as WellbeingCheckin[],
  };
}

export async function pushFullSnapshot(snapshot: CloudSnapshot) {
  if (!snapshot.profile) return;
  await syncProfile(snapshot.profile);
  if (snapshot.schedulePrefs) await syncSchedulePrefs(snapshot.schedulePrefs);
  await syncCycles(snapshot.cycles);
  await syncScheduledSessions(snapshot.scheduledSessions);
  await syncProgressionStates(snapshot.progressionStates);
  for (const session of snapshot.trainingSessions) {
    const items = snapshot.sessionItems.filter(
      (i) => i.training_session_id === session.id,
    );
    const itemIds = new Set(items.map((i) => i.id));
    await syncTrainingSessionBundle({
      session,
      items,
      setResults: snapshot.setResults.filter((r) =>
        itemIds.has(r.session_item_id),
      ),
      exerciseResults: snapshot.exerciseResults.filter((r) =>
        itemIds.has(r.session_item_id),
      ),
      events: snapshot.progressionEvents.filter((e) =>
        itemIds.has(e.session_item_id),
      ),
    });
  }
  for (const wb of snapshot.wellbeingCheckins) {
    await syncWellbeing(wb);
  }
}

export function queueOrSync(task: () => Promise<void>) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    // Deferred — AutoSync will pushFullSnapshot when back online
    return;
  }
  void task().catch((err) => {
    console.error("[supabase sync]", err);
  });
}
