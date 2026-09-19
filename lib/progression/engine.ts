import type { ProgressionEvent, ProgressionState } from "@/lib/types";
import { clone, uid } from "@/lib/utils";
import {
  FLAG_LEVELS,
  HSPU_LEVELS,
  OAHS_LEVELS,
  PLANCHE_LEVELS,
  LEVER_LEVELS,
} from "@/lib/types";

export interface CompletionInput {
  ruleCode: string;
  completedAll: boolean;
  difficulty?: number | null;
  painScore?: number | null;
  sharpPain?: boolean;
  metrics?: Record<string, unknown>;
  sessionItemId: string;
  userId: string;
  /** For flag context monday/saturday */
  flagContext?: "monday" | "saturday";
  problemLetter?: string;
  attemptsToComplete?: number | null;
}

export interface ProgressionResult {
  state: ProgressionState;
  event: ProgressionEvent;
  nextPrescriptionPreview: string;
  frozen: boolean;
}

function advanceIn<T extends string>(list: readonly T[], current: string): T {
  const i = list.indexOf(current as T);
  if (i < 0 || i >= list.length - 1) return (list[list.length - 1] ?? current) as T;
  return list[i + 1]!;
}

export function evaluateProgression(
  current: ProgressionState,
  input: CompletionInput,
): ProgressionResult {
  const before = clone(current.state);
  const state = clone(current);
  const now = new Date().toISOString();
  let explanation = "";
  let preview = "";
  let eventType: ProgressionEvent["event_type"] = "hold";
  let frozen = false;

  if (input.sharpPain || (input.painScore != null && input.painScore >= 4)) {
    frozen = true;
    eventType = "pain_freeze";
    explanation =
      input.sharpPain
        ? "Sharp/radiating pain reported — progression frozen for this exercise. Stop and assess."
        : `Pain ${input.painScore}/10 — progression frozen for this exercise this session.`;
    preview = "Prescription unchanged (pain-limited).";
    const event: ProgressionEvent = {
      id: uid("pe"),
      user_id: input.userId,
      session_item_id: input.sessionItemId,
      rule_code: input.ruleCode,
      event_type: eventType,
      before,
      after: clone(state.state),
      explanation,
      next_prescription_preview: preview,
      created_at: now,
      undone_at: null,
    };
    return { state, event, nextPrescriptionPreview: preview, frozen };
  }

  const yes = input.completedAll;

  switch (input.ruleCode) {
    case "WEIGHTED_PULLUP_4X5_V1": {
      const load = Number(state.state.load_kg ?? 20);
      if (yes) {
        state.state.load_kg = load + 1;
        state.state.consecutive_failures = 0;
        state.consecutive_failures = 0;
        eventType = "success";
        explanation = `Completed all reps @ +${load} kg → next load +${load + 1} kg.`;
        preview = `Next: 4 × 5 @ +${load + 1} kg`;
      } else {
        const fails = Number(state.state.consecutive_failures ?? 0) + 1;
        state.state.consecutive_failures = fails;
        state.consecutive_failures = fails;
        if (fails >= 2) {
          state.state.load_kg = Math.max(0, load - 2);
          state.state.consecutive_failures = 0;
          state.consecutive_failures = 0;
          eventType = "failure";
          explanation = `Two consecutive failures at +${load} kg → reduce to +${state.state.load_kg} kg.`;
          preview = `Next: 4 × 5 @ +${state.state.load_kg} kg`;
        } else {
          eventType = "failure";
          explanation = `Partial/failure at +${load} kg — repeat same load (failure ${fails}/2).`;
          preview = `Next: 4 × 5 @ +${load} kg`;
        }
      }
      break;
    }
    case "HSPU_LEVEL_V1": {
      const reps = Number(state.state.reps_per_set ?? 5);
      const level = String(state.state.level ?? state.current_level ?? "wall");
      if (yes) {
        if (reps < 7) {
          state.state.reps_per_set = reps + 1;
          eventType = "success";
          explanation = `Success at 4×${reps} → next 4×${reps + 1}.`;
          preview = `Next: 4 × ${reps + 1} @ ${level.replace(/_/g, " ")}`;
        } else {
          const next = advanceIn(HSPU_LEVELS, level);
          state.state.level = next;
          state.current_level = next;
          state.state.reps_per_set = 5;
          eventType = "advance";
          explanation = `Completed 4×7 @ ${level.replace(/_/g, " ")} → advance to ${next.replace(/_/g, " ")}, reset 4×5.`;
          preview = `Next: 4 × 5 @ ${next.replace(/_/g, " ")}`;
        }
      } else {
        eventType = "failure";
        explanation = `Incomplete — repeat exact 4×${reps} @ ${level.replace(/_/g, " ")}.`;
        preview = `Next: 4 × ${reps} @ ${level.replace(/_/g, " ")}`;
      }
      break;
    }
    case "PLANCHE_V1": {
      const protocol = String(input.metrics?.protocol ?? "hard");
      if (protocol !== "hard") {
        eventType = "hold";
        explanation = `${protocol} planche session logged — level changes are driven by hard sessions.`;
        preview = `Level: ${String(state.state.level).replace(/_/g, " ")}`;
        break;
      }
      if (yes) {
        const credits = Number(state.state.hard_success_credits ?? 0) + 1;
        state.state.hard_success_credits = credits;
        state.state.hard_fail_streak = 0;
        state.success_credits = credits;
        if (credits >= 2) {
          const next = advanceIn(PLANCHE_LEVELS, String(state.state.level));
          state.state.level = next;
          state.current_level = next;
          state.state.hard_hold_seconds = 5;
          state.state.medium_hold_seconds = 4;
          state.state.light_hold_seconds = 4;
          state.state.hard_success_credits = 0;
          state.success_credits = 0;
          eventType = "advance";
          explanation = `2 hard-success credits → advanced to ${next.replace(/_/g, " ")}. Holds reset to 5/4/4 sec.`;
          preview = `Next hard: 5 × 5 sec @ ${next.replace(/_/g, " ")}`;
        } else {
          // rebuild toward original targets
          const hard = Number(state.state.hard_hold_seconds ?? 8);
          if (hard < 8) state.state.hard_hold_seconds = hard + 1;
          const med = Number(state.state.medium_hold_seconds ?? 6);
          if (med < 6) state.state.medium_hold_seconds = med + 1;
          const light = Number(state.state.light_hold_seconds ?? 6);
          if (light < 6) state.state.light_hold_seconds = light + 1;
          eventType = "credit";
          explanation = `Hard session success — progression credit ${credits} of 2.`;
          preview = `Progression credit ${credits} of 2 · holds ${state.state.hard_hold_seconds}s`;
        }
      } else {
        const fails = Number(state.state.hard_fail_streak ?? 0) + 1;
        state.state.hard_fail_streak = fails;
        if (fails >= 3) {
          const hard = Number(state.state.hard_hold_seconds ?? 8);
          state.state.hard_hold_seconds = Math.max(3, Math.round(hard * 0.8));
          state.state.hard_fail_streak = 0;
          eventType = "failure";
          explanation = `3 failed hard sessions — reduce hold duration 20% to ${state.state.hard_hold_seconds}s (level unchanged).`;
          preview = `Next hard holds: ${state.state.hard_hold_seconds}s`;
        } else {
          eventType = "failure";
          explanation = `Hard session incomplete — fail streak ${fails}/3. Level unchanged.`;
          preview = `Level: ${String(state.state.level).replace(/_/g, " ")}`;
        }
      }
      break;
    }
    case "OAHS_V1": {
      if (yes) {
        const credits = Number(state.state.skill_credits ?? 0) + 1;
        state.state.skill_credits = credits;
        state.success_credits = credits;
        state.consecutive_successes = Number(state.consecutive_successes) + 1;
        if (credits >= 3) {
          const next = advanceIn(OAHS_LEVELS, String(state.state.level));
          const prev = String(state.state.level);
          state.state.level = next;
          state.current_level = next;
          state.state.skill_credits = 0;
          state.success_credits = 0;
          eventType = "advance";
          explanation =
            prev === next && prev.includes("free")
              ? "Already at free level — keep building clean hold duration."
              : `3 successful practice sessions → advanced to ${next.replace(/_/g, " ")}.`;
          preview = `Next OAHS: ${next.replace(/_/g, " ")}`;
        } else {
          eventType = "credit";
          explanation = `OAHS practice complete — skill credit ${credits} of 3.`;
          preview = `Progression credit ${credits} of 3`;
        }
        if (typeof input.metrics?.best_left === "number") {
          state.state.best_hold_left_sec = Math.max(
            Number(state.state.best_hold_left_sec ?? 0),
            Number(input.metrics.best_left),
          );
        }
        if (typeof input.metrics?.best_right === "number") {
          state.state.best_hold_right_sec = Math.max(
            Number(state.state.best_hold_right_sec ?? 0),
            Number(input.metrics.best_right),
          );
        }
      } else {
        state.consecutive_successes = 0;
        eventType = "failure";
        explanation = "Incomplete OAHS block — consecutive-success counter reset (level unchanged).";
        preview = `Level: ${String(state.state.level).replace(/_/g, " ")}`;
      }
      break;
    }
    case "FRONT_SPLIT_V1": {
      if (yes) {
        const side = String(input.metrics?.side ?? "both");
        const apply = (key: "left" | "right") => {
          const creditKey = key === "left" ? "left_credits" : "right_credits";
          const gapKey = key === "left" ? "left_gap_cm" : "right_gap_cm";
          const credits = Number(state.state[creditKey] ?? 0) + 1;
          if (credits >= 2) {
            const gap = Math.max(0, Number(state.state[gapKey] ?? 10) - 1);
            state.state[gapKey] = gap;
            state.state[creditKey] = 0;
            return `${key} gap → ${gap} cm`;
          }
          state.state[creditKey] = credits;
          return `${key} credit ${credits}/2`;
        };
        const parts =
          side === "left"
            ? [apply("left")]
            : side === "right"
              ? [apply("right")]
              : [apply("left"), apply("right")];
        eventType = "credit";
        explanation = `Front split success — ${parts.join("; ")}.`;
        preview = `Targets L ${state.state.left_gap_cm} cm / R ${state.state.right_gap_cm} cm`;
      } else {
        eventType = "failure";
        explanation = "Front split incomplete — no credit.";
        preview = `Targets L ${state.state.left_gap_cm} cm / R ${state.state.right_gap_cm} cm`;
      }
      break;
    }
    case "MIDDLE_SPLIT_V1": {
      if (yes) {
        const credits = Number(state.state.success_credits ?? 0) + 1;
        if (credits >= 2) {
          state.state.gap_cm = Math.max(0, Number(state.state.gap_cm ?? 15) - 1);
          state.state.success_credits = 0;
          eventType = "advance";
          explanation = `2 deep-session credits → middle-split target ${state.state.gap_cm} cm.`;
        } else {
          state.state.success_credits = credits;
          eventType = "credit";
          explanation = `Middle split success — credit ${credits}/2.`;
        }
        preview = `Target gap ${state.state.gap_cm} cm`;
      } else {
        eventType = "failure";
        explanation = "Middle split incomplete — no credit.";
        preview = `Target gap ${state.state.gap_cm} cm`;
      }
      break;
    }
    case "HUMAN_FLAG_V1": {
      const ctx = input.flagContext ?? "monday";
      const key = ctx === "saturday" ? "saturday_hold_seconds" : "monday_hold_seconds";
      if (yes) {
        const cur = Number(state.state[key] ?? (ctx === "saturday" ? 8 : 6));
        const next = Math.min(10, cur + 1);
        state.state[key] = next;
        const mon = Number(state.state.monday_hold_seconds ?? 6);
        const sat = Number(state.state.saturday_hold_seconds ?? 8);
        if (mon >= 10 && sat >= 10 && input.metrics?.bothContextsReady) {
          const nextLevel = advanceIn(FLAG_LEVELS, String(state.state.level));
          state.state.level = nextLevel;
          state.current_level = nextLevel;
          state.state.monday_hold_seconds = 5;
          state.state.saturday_hold_seconds = 6;
          eventType = "advance";
          explanation = `Both contexts at 10s → advanced to ${nextLevel.replace(/_/g, " ")}. Reset Mon 5s / Sat 6s.`;
          preview = `Next ${ctx}: ${ctx === "saturday" ? 6 : 5}s @ ${nextLevel.replace(/_/g, " ")}`;
        } else {
          eventType = "success";
          explanation = `${ctx} flag success → ${next}s next time (cap 10).`;
          preview = `Next ${ctx}: ${next}s`;
        }
      } else {
        eventType = "failure";
        explanation = "Flag incomplete — hold target unchanged.";
        preview = `Next ${ctx}: ${state.state[key]}s`;
      }
      break;
    }
    case "FRONT_LEVER_V1":
    case "BACK_LEVER_V1": {
      const label = input.ruleCode === "FRONT_LEVER_V1" ? "Front lever" : "Back lever";
      const level = String(state.state.level ?? state.current_level ?? "tuck");
      const protocol = String(input.metrics?.lever_protocol ?? "hard");
      if (protocol !== "hard") {
        eventType = "hold";
        explanation = `${label}: light technique exposure logged — only hard sessions earn progression credits.`;
        preview = `Current level: ${level.replace(/_/g, " ")} · ${state.state.success_credits ?? 0}/3 hard-session credits`;
        break;
      }
      if (yes && (input.difficulty == null || input.difficulty <= 8)) {
        const credits = Number(state.state.success_credits ?? 0) + 1;
        state.state.success_credits = credits;
        if (credits >= 3) {
          const next = advanceIn(LEVER_LEVELS, level);
          state.state.level = next;
          state.current_level = next;
          state.state.success_credits = 0;
          eventType = next === level ? "hold" : "advance";
          explanation =
            next === level
              ? `${label}: full progression maintained — keep building clean hold quality.`
              : `${label}: 3 clean successful sessions → advance to ${next.replace(/_/g, " ")}.`;
          preview = `Next: 3 × 8s @ ${next.replace(/_/g, " ")}`;
        } else {
          eventType = "credit";
          explanation = `${label} success — progression credit ${credits}/3.`;
          preview = `Current level: ${level.replace(/_/g, " ")} · ${credits}/3 credits`;
        }
      } else {
        state.state.success_credits = 0;
        eventType = yes ? "hold" : "failure";
        explanation = yes
          ? `${label} completed at high effort — hold the current level until it is controlled.`
          : `${label} incomplete — hold current level.`;
        preview = `Next: same ${level.replace(/_/g, " ")} progression`;
      }
      break;
    }
    case "SINGLE_LEG_RDL_V1": {
      const load = Number(state.state.load_kg ?? 0);
      if (yes && (input.difficulty == null || input.difficulty <= 8)) {
        state.state.load_kg = load + 2;
        eventType = "success";
        explanation = `Single-leg RDL complete with control → +${load + 2} kg next time.`;
      } else {
        eventType = yes ? "hold" : "failure";
        explanation = "Single-leg RDL held at the same load until both sides are controlled.";
      }
      preview = `Next: 3 × 8/leg @ +${state.state.load_kg ?? load} kg`;
      break;
    }
    case "RUN_INTERVALS_V1": {
      const rounds = Number(state.state.rounds ?? 6);
      const strongSec = Number(state.state.strong_sec ?? 120);
      const easySec = Number(state.state.easy_sec ?? 120);
      const paceOffset = Number(state.state.pace_offset_sec_per_km ?? 0);
      if (yes && (input.difficulty == null || input.difficulty <= 8)) {
        if (easySec > 90) {
          state.state.easy_sec = easySec - 10;
          eventType = "success";
          explanation = `Intervals controlled → easy-jog recovery reduced to ${easySec - 10}s.`;
        } else if (rounds < 8) {
          state.state.rounds = rounds + 1;
          eventType = "success";
          explanation = `Intervals controlled at 90s recovery → add one strong repeat (${rounds + 1} total).`;
        } else {
          state.state.pace_offset_sec_per_km = paceOffset - 5;
          eventType = "advance";
          explanation = "8 repeats controlled → keep the structure and target about 5 sec/km faster on strong reps.";
        }
      } else {
        eventType = yes ? "hold" : "failure";
        explanation = yes
          ? "Intervals completed but effort was high — repeat the same structure."
          : "Intervals incomplete — repeat the same structure.";
      }
      preview = `Next: ${state.state.rounds ?? rounds} × (${strongSec}s strong + ${state.state.easy_sec ?? easySec}s easy jog)${
        Number(state.state.pace_offset_sec_per_km ?? 0) < 0
          ? ` · pace target ${Math.abs(Number(state.state.pace_offset_sec_per_km))} sec/km faster than baseline`
          : ""
      }`;
      break;
    }
    case "BULGARIAN_SPLIT_V1": {
      const load = Number(state.state.load_kg ?? 0);
      if (yes) {
        state.state.load_kg = load + 2;
        state.state.consecutive_failures = 0;
        eventType = "success";
        explanation = `Success → next load +${load + 2} kg.`;
        preview = `Next: 3 × 8/leg @ +${load + 2} kg`;
      } else {
        const fails = Number(state.state.consecutive_failures ?? 0) + 1;
        state.state.consecutive_failures = fails;
        if (fails >= 2) {
          state.state.load_kg = Math.max(0, load - 2);
          state.state.consecutive_failures = 0;
          eventType = "failure";
          explanation = `Two failures → reduce to +${state.state.load_kg} kg.`;
        } else {
          eventType = "failure";
          explanation = "Failure — hold load.";
        }
        preview = `Next: 3 × 8/leg @ +${state.state.load_kg} kg`;
      }
      break;
    }
    case "STRICT_MUSCLE_UP_V1": {
      if (yes) {
        const credits = Number(state.state.success_credits ?? 0) + 1;
        state.state.success_credits = credits;
        state.state.fail_credits = 0;
        if (credits >= 2) {
          state.state.load_kg = Number(state.state.load_kg ?? 0) + 1;
          state.state.success_credits = 0;
          eventType = "success";
          explanation = `2 clean sessions → +1 kg (now +${state.state.load_kg} kg).`;
        } else {
          eventType = "credit";
          explanation = `Clean muscle-up session — credit ${credits}/2.`;
        }
      } else {
        const fails = Number(state.state.fail_credits ?? 0) + 1;
        state.state.fail_credits = fails;
        state.state.success_credits = 0;
        if (fails >= 2) {
          state.state.load_kg = Math.max(0, Number(state.state.load_kg ?? 0) - 1);
          state.state.fail_credits = 0;
          eventType = "failure";
          explanation = `Two failures → remove 1 kg (now +${state.state.load_kg} kg).`;
        } else {
          eventType = "failure";
          explanation = "Failure — keep load.";
        }
      }
      preview = `Next: 4 × 3 @ +${state.state.load_kg ?? 0} kg`;
      break;
    }
    case "MOBILITY_MAINTAIN_V1": {
      eventType = "hold";
      explanation = yes
        ? "Maintenance complete — quality maintained; volume unchanged."
        : "Maintenance partial — keep same dose next time.";
      preview = "Same prescription (maintenance)";
      break;
    }
    case "SWIM_PERFORMANCE_V1": {
      if (yes && (input.difficulty == null || input.difficulty <= 8)) {
        let repeats = Number(state.state.strong_repeats ?? 6);
        let total = Number(state.state.total_m ?? 900);
        let rest = Number(state.state.strong_rest ?? 30);
        if (total < 1200) {
          repeats += 1;
          total += 50;
          state.state.strong_repeats = repeats;
          state.state.total_m = total;
          eventType = "success";
          explanation = `Swim success → add one 50 m strong repeat (now ${repeats}, ~${total} m).`;
        } else if (rest > 15) {
          rest -= 5;
          state.state.strong_rest = rest;
          eventType = "success";
          explanation = `At 1200 m cap — reduce strong-repeat rest to ${rest}s.`;
        } else {
          eventType = "hold";
          explanation = "At volume and rest caps — hold prescription.";
        }
        preview = `Next: ${state.state.strong_repeats} × 50 m strong @ ${state.state.strong_rest}s rest`;
      } else {
        eventType = "hold";
        explanation = "Swim incomplete or hard — prescription unchanged.";
        preview = `Next: ${state.state.strong_repeats} × 50 m`;
      }
      break;
    }
    case "SWIM_RECOVERY_V1":
    case "RUN_DELOAD_V1": {
      eventType = "hold";
      explanation = "Recovery/deload prescription — no overload progression.";
      preview = "Same recovery prescription";
      break;
    }
    case "CLIMB_QUALITY_V1": {
      const letter = input.problemLetter ?? "A";
      const grades = {
        ...((state.state.grades as Record<string, string>) ?? {}),
      };
      const attempts = input.attemptsToComplete;
      if (attempts != null && attempts <= 2) {
        grades[letter] = bumpGrade(grades[letter] ?? "V2");
        state.state.grades = grades;
        eventType = "advance";
        explanation = `Problem ${letter} sent in ${attempts} attempts → next ${grades[letter]}.`;
      } else {
        eventType = "hold";
        explanation = `Problem ${letter} — grade held (${grades[letter] ?? "V2"}).`;
      }
      preview = `Problem ${letter}: ${grades[letter] ?? "V2"}`;
      break;
    }
    case "CLIMB_ENDURANCE_V1": {
      if (yes) {
        let sec = Number(state.state.interval_sec ?? 240);
        if (sec < 360) {
          sec += 30;
          state.state.interval_sec = sec;
          eventType = "success";
          explanation = `Endurance complete → intervals ${sec / 60} min.`;
        } else {
          state.state.interval_sec = 240;
          state.state.grade_step = Number(state.state.grade_step ?? 0) + 1;
          eventType = "advance";
          explanation = "3×6 min success → raise circuit grade one step, reset 3×4 min.";
        }
      } else {
        eventType = "failure";
        explanation = "Endurance incomplete — hold duration.";
      }
      preview = `Next: 3 × ${Number(state.state.interval_sec) / 60} min`;
      break;
    }
    case "PULLUP_VOLUME_V1":
    case "DIP_VOLUME_V1":
    case "PUSHUP_VOLUME_V1":
    case "WALKING_LUNGE_V1":
    case "DRAGON_FLAG_V1":
    case "GLUTE_BRIDGE_V1":
    case "CALF_RAISE_V1":
    case "TIBIALIS_V1":
    case "HANGING_SLR_V1":
    case "PISTOL_SQUAT_V1":
    case "COPENHAGEN_V1":
    case "NORDIC_CURL_V1":
    case "INVERTED_ROW_V1":
    case "CLAP_PUSHUP_V1":
    case "BROAD_JUMP_V1":
    case "POGO_JUMP_V1":
    case "SPRINT_20M_V1":
    case "SHUTTLE_5105_V1":
    case "BURPEE_CLIMBER_V1":
    case "RUN_STEADY_V1":
    case "RUN_LONG_V1": {
      const r = applyGenericVolumeRule(input.ruleCode, state, yes, input);
      explanation = r.explanation;
      preview = r.preview;
      eventType = r.eventType;
      break;
    }
    default: {
      eventType = yes ? "success" : "failure";
      explanation = yes
        ? "Completed — state acknowledged."
        : "Partial — state unchanged.";
      preview = "See current prescription";
    }
  }

  state.updated_at = now;
  const event: ProgressionEvent = {
    id: uid("pe"),
    user_id: input.userId,
    session_item_id: input.sessionItemId,
    rule_code: input.ruleCode,
    event_type: eventType,
    before,
    after: clone(state.state),
    explanation,
    next_prescription_preview: preview,
    created_at: now,
    undone_at: null,
  };
  return { state, event, nextPrescriptionPreview: preview, frozen };
}

function bumpGrade(g: string): string {
  const m = /^V(\d+)$/i.exec(g);
  if (m) return `V${Number(m[1]) + 1}`;
  return g;
}

function applyGenericVolumeRule(
  code: string,
  state: ProgressionState,
  yes: boolean,
  input: CompletionInput,
): {
  explanation: string;
  preview: string;
  eventType: ProgressionEvent["event_type"];
} {
  if (!yes) {
    return {
      explanation: "Incomplete — prescription held.",
      preview: "Same prescription",
      eventType: "failure",
    };
  }

  switch (code) {
    case "PULLUP_VOLUME_V1": {
      let reps = Number(state.state.reps_per_set ?? 10);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 12) reps += 1;
      else {
        load += 2;
        reps = 8;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Pull-up success → 4×${reps}${load ? ` @ +${load} kg` : ""}.`,
        preview: `Next: 4 × ${reps}${load ? ` @ +${load} kg` : ""}`,
        eventType: "success",
      };
    }
    case "DIP_VOLUME_V1": {
      let reps = Number(state.state.reps_per_set ?? 12);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 15) reps += 1;
      else {
        load += 2;
        reps = 10;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Dip success → 4×${reps}${load ? ` @ +${load} kg` : ""}.`,
        preview: `Next: 4 × ${reps}${load ? ` @ +${load} kg` : ""}`,
        eventType: "success",
      };
    }
    case "PUSHUP_VOLUME_V1": {
      let reps = Number(state.state.reps_per_set ?? 20);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 30) reps += 2;
      else {
        load += 5;
        reps = 20;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Push-up success → 3×${reps}${load ? ` @ +${load} kg` : ""}.`,
        preview: `Next: 3 × ${reps}${load ? ` @ +${load} kg` : ""}`,
        eventType: "success",
      };
    }
    case "WALKING_LUNGE_V1": {
      let reps = Number(state.state.reps_per_set ?? 12);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 15) reps += 1;
      else {
        load += 4;
        reps = 12;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Lunge success → ${reps}/leg${load ? ` @ +${load} kg` : ""}.`,
        preview: `Next: 3 × ${reps}/leg`,
        eventType: "success",
      };
    }
    case "DRAGON_FLAG_V1": {
      let reps = Number(state.state.reps_per_set ?? 6);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 8) reps += 1;
      else {
        load += 0.5;
        reps = 6;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Dragon flag success → 3×${reps}.`,
        preview: `Next: 3 × ${reps}`,
        eventType: "success",
      };
    }
    case "GLUTE_BRIDGE_V1": {
      let reps = Number(state.state.reps_per_set ?? 12);
      if (reps < 15) reps += 1;
      else {
        state.state.elevated = true;
        reps = 12;
      }
      state.state.reps_per_set = reps;
      return {
        explanation: `Glute bridge success → 3×${reps}${state.state.elevated ? " elevated" : ""}.`,
        preview: `Next: 3 × ${reps}/leg`,
        eventType: "success",
      };
    }
    case "CALF_RAISE_V1": {
      let reps = Number(state.state.reps_per_set ?? 15);
      let load = Number(state.state.load_kg ?? 0);
      if (reps < 20) reps += 1;
      else {
        load += 5;
        reps = 15;
      }
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Calf success → 3×${reps}.`,
        preview: `Next: 3 × ${reps}/leg`,
        eventType: "success",
      };
    }
    case "TIBIALIS_V1": {
      let reps = Number(state.state.reps_per_set ?? 20);
      let dist = Number(state.state.feet_distance_cm ?? 0);
      if (reps < 30) reps += 2;
      else {
        dist += 5;
        reps = 20;
      }
      state.state.reps_per_set = reps;
      state.state.feet_distance_cm = dist;
      return {
        explanation: `Tibialis success → 3×${reps}.`,
        preview: `Next: 3 × ${reps}`,
        eventType: "success",
      };
    }
    case "HANGING_SLR_V1": {
      let reps = Number(state.state.reps_per_set ?? 10);
      let variation = String(state.state.variation ?? "straight_leg");
      let load = Number(state.state.load_kg ?? 0);
      if (variation === "straight_leg") {
        if (reps < 12) reps += 1;
        else {
          variation = "toes_to_bar";
          reps = 8;
        }
      } else if (reps < 10) reps += 1;
      else {
        load += 0.5;
        reps = 8;
      }
      state.state.reps_per_set = reps;
      state.state.variation = variation;
      state.state.load_kg = load;
      return {
        explanation: `Core success → ${variation.replace(/_/g, " ")} 3×${reps}.`,
        preview: `Next: 3 × ${reps}`,
        eventType: "success",
      };
    }
    case "PISTOL_SQUAT_V1": {
      state.state.load_kg = Number(state.state.load_kg ?? 0) + 1;
      return {
        explanation: `Pistol success → +${state.state.load_kg} kg.`,
        preview: `Next: 3 × 6/leg @ +${state.state.load_kg} kg`,
        eventType: "success",
      };
    }
    case "COPENHAGEN_V1": {
      let hold = Number(state.state.hold_seconds ?? 20);
      if (hold < 30) hold += 5;
      else {
        state.state.longer_lever = true;
        hold = 20;
      }
      state.state.hold_seconds = hold;
      return {
        explanation: `Copenhagen success → ${hold}s/side.`,
        preview: `Next: 3 × ${hold}s/side`,
        eventType: "success",
      };
    }
    case "NORDIC_CURL_V1": {
      let assist = Number(state.state.assistance_level ?? 2);
      let ecc = Number(state.state.eccentric_sec ?? 3);
      let reps = Number(state.state.reps_per_set ?? 5);
      let load = Number(state.state.load_kg ?? 0);
      if (assist > 0) assist -= 1;
      else if (ecc < 5) ecc += 1;
      else if (reps < 7) reps += 1;
      else {
        load += 1;
        reps = 5;
        ecc = 3;
      }
      state.state.assistance_level = assist;
      state.state.eccentric_sec = ecc;
      state.state.reps_per_set = reps;
      state.state.load_kg = load;
      return {
        explanation: `Nordic success → assist ${assist}, ${ecc}s ecc, 3×${reps}.`,
        preview: `Next: 3 × ${reps}`,
        eventType: "success",
      };
    }
    case "INVERTED_ROW_V1": {
      let reps = Number(state.state.reps_per_set ?? 12);
      let level = Number(state.state.level ?? 0);
      if (reps < 15) reps += 1;
      else {
        level += 1;
        reps = 12;
      }
      state.state.reps_per_set = reps;
      state.state.level = level;
      return {
        explanation: `Inverted row success → 3×${reps}.`,
        preview: `Next: 3 × ${reps}`,
        eventType: "success",
      };
    }
    case "CLAP_PUSHUP_V1": {
      const credits = Number(state.state.success_credits ?? 0) + 1;
      state.state.success_credits = credits;
      if (credits >= 3) {
        state.state.level = Number(state.state.level ?? 0) + 1;
        state.state.success_credits = 0;
        return {
          explanation: "3 successes → advance explosive push-up variation.",
          preview: "Next: higher explosive variation 3×5",
          eventType: "advance",
        };
      }
      return {
        explanation: `Clap push-up success — credit ${credits}/3.`,
        preview: `Progression credit ${credits} of 3`,
        eventType: "credit",
      };
    }
    case "BROAD_JUMP_V1": {
      const median = Number(input.metrics?.median_cm ?? state.state.last_median_cm ?? 200);
      const next = Math.round(median * 1.01);
      state.state.last_median_cm = median;
      state.state.target_cm = next;
      return {
        explanation: `Quality landings — next target ${next} cm.`,
        preview: `Next target: ${next} cm`,
        eventType: "success",
      };
    }
    case "POGO_JUMP_V1": {
      const credits = Number(state.state.success_credits ?? 0) + 1;
      state.state.success_credits = credits;
      if (credits >= 3) {
        state.state.level = Number(state.state.level ?? 0) + 1;
        state.state.success_credits = 0;
        return {
          explanation: "3 successes → advance pogo stiffness/height level.",
          preview: `Level ${state.state.level}`,
          eventType: "advance",
        };
      }
      return {
        explanation: `Pogo success — credit ${credits}/3.`,
        preview: `Progression credit ${credits} of 3`,
        eventType: "credit",
      };
    }
    case "SPRINT_20M_V1":
    case "SHUTTLE_5105_V1": {
      const best = Number(input.metrics?.best_sec ?? state.state.best_sec ?? 4);
      const next = Number((best * 0.995).toFixed(3));
      state.state.best_sec = best;
      state.state.target_sec = next;
      return {
        explanation: `Consistent reps — next target ${next}s.`,
        preview: `Next target: ${next}s`,
        eventType: "success",
      };
    }
    case "BURPEE_CLIMBER_V1": {
      let rest = Number(state.state.round_rest ?? 30);
      let burpees = Number(state.state.burpees ?? 8);
      let climbers = Number(state.state.climbers ?? 20);
      if (rest > 15) rest -= 5;
      else if (burpees < 12) {
        rest = 30;
        burpees += 1;
        climbers += 2;
      }
      state.state.round_rest = rest;
      state.state.burpees = burpees;
      state.state.climbers = climbers;
      return {
        explanation: `Circuit success → ${burpees} burpees + ${climbers} climbers, ${rest}s rest.`,
        preview: `Next: ${burpees}+${climbers}, ${rest}s rest`,
        eventType: "success",
      };
    }
    case "RUN_INTERVALS_V1": {
      if (input.difficulty != null && input.difficulty > 8) {
        return {
          explanation: "Completed but difficulty >8 — pace held.",
          preview: "Same interval pace",
          eventType: "hold",
        };
      }
      state.state.pace_offset_sec_per_km =
        Number(state.state.pace_offset_sec_per_km ?? 0) - 5;
      return {
        explanation: "Intervals success → next-cycle pace −5 sec/km.",
        preview: "Pace target improved 5 sec/km next cycle",
        eventType: "success",
      };
    }
    case "RUN_STEADY_V1": {
      if (input.difficulty != null && input.difficulty > 7) {
        return {
          explanation: "Difficulty >7 — duration held.",
          preview: "Same duration",
          eventType: "hold",
        };
      }
      let dur = Number(state.state.duration_sec ?? 1440);
      if (dur < 1800) dur += 120;
      else {
        state.state.pace_offset_sec_per_km =
          Number(state.state.pace_offset_sec_per_km ?? 0) - 5;
      }
      state.state.duration_sec = Math.min(1800, dur);
      return {
        explanation: `Steady run success → ${Math.round(Number(state.state.duration_sec) / 60)} min.`,
        preview: `Next: ${Math.round(Number(state.state.duration_sec) / 60)} min`,
        eventType: "success",
      };
    }
    case "RUN_LONG_V1": {
      let dur = Number(state.state.duration_sec ?? 2400);
      if (dur < 3600) dur += 300;
      else {
        state.state.pace_offset_sec_per_km =
          Number(state.state.pace_offset_sec_per_km ?? 0) - 5;
      }
      state.state.duration_sec = Math.min(3600, dur);
      return {
        explanation: `Long run success → ${Math.round(Number(state.state.duration_sec) / 60)} min.`,
        preview: `Next: ${Math.round(Number(state.state.duration_sec) / 60)} min`,
        eventType: "success",
      };
    }
    default:
      return {
        explanation: "Logged.",
        preview: "Same prescription",
        eventType: "success",
      };
  }
}

export function undoProgressionEvent(
  state: ProgressionState,
  event: ProgressionEvent,
): ProgressionState {
  const restored = clone(state);
  restored.state = clone(event.before);
  restored.updated_at = new Date().toISOString();
  return restored;
}
