"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FLAG_LEVELS,
  HSPU_LEVELS,
  OAHS_LEVELS,
  PLANCHE_LEVELS,
  type OnboardingDraft,
} from "@/lib/types";
import { defaultWeekdayMap, useAppStore } from "@/lib/store/app-store";
import { PrimaryButton, SecondaryButton, Card } from "@/components/ui/primitives";

const steps = [
  "Units & equipment",
  "Skill levels",
  "Loads & splits",
  "Swim & climbing",
  "Schedule",
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>({
    units: "metric",
    smallest_load_increment_kg: 1,
    pool_length_m: 25,
    equipment: {
      pull_up_bar: true,
      dip_bars: true,
      rings: false,
      weight_belt: true,
      pool: true,
      climbing_gym: true,
    },
    oahs_level: "five_finger",
    planche_level: "tuck",
    flag_level: "one_leg",
    hspu_level: "wall",
    weighted_pullup_kg: 20,
    bulgarian_kg: 0,
    front_split_left_cm: 10,
    front_split_right_cm: 10,
    middle_split_cm: 15,
    climbing_grade: "V2",
    project_grade: "V4",
    weekday_map: defaultWeekdayMap() as OnboardingDraft["weekday_map"],
  });

  function finish() {
    completeOnboarding(draft);
    router.replace("/today");
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">
        Lifetime Athlete
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Set your starting levels
      </h1>
      <p className="mt-2 text-sm text-muted">
        Only values that personalize prescriptions — the plan itself is already defined.
      </p>

      <div className="mt-6 flex gap-2">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <p className="mt-2 text-sm font-medium">{steps[step]}</p>

      <Card className="mt-4 flex-1 space-y-4">
        {step === 0 && (
          <>
            <label className="block text-sm">
              Units
              <select
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
                value={draft.units}
                onChange={(e) =>
                  setDraft({ ...draft, units: e.target.value as "metric" | "imperial" })
                }
              >
                <option value="metric">Metric (kg, km, m)</option>
                <option value="imperial">Imperial</option>
              </select>
            </label>
            <label className="block text-sm">
              Smallest load increment (kg)
              <input
                type="number"
                step="0.5"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
                value={draft.smallest_load_increment_kg}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    smallest_load_increment_kg: Number(e.target.value),
                  })
                }
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Equipment</legend>
              {(
                Object.keys(draft.equipment) as (keyof typeof draft.equipment)[]
              ).map((key) => (
                <label key={key} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.equipment[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        equipment: { ...draft.equipment, [key]: e.target.checked },
                      })
                    }
                  />
                  {key.replace(/_/g, " ")}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {step === 1 && (
          <>
            <Select
              label="OAHS level"
              value={draft.oahs_level}
              options={OAHS_LEVELS}
              onChange={(v) => setDraft({ ...draft, oahs_level: v })}
            />
            <Select
              label="Planche level"
              value={draft.planche_level}
              options={PLANCHE_LEVELS}
              onChange={(v) => setDraft({ ...draft, planche_level: v })}
            />
            <Select
              label="Human flag level"
              value={draft.flag_level}
              options={FLAG_LEVELS}
              onChange={(v) => setDraft({ ...draft, flag_level: v })}
            />
            <Select
              label="HSPU level"
              value={draft.hspu_level}
              options={HSPU_LEVELS}
              onChange={(v) => setDraft({ ...draft, hspu_level: v })}
            />
          </>
        )}

        {step === 2 && (
          <>
            <NumberField
              label="Weighted pull-up starting load (kg)"
              value={draft.weighted_pullup_kg}
              onChange={(v) => setDraft({ ...draft, weighted_pullup_kg: v })}
            />
            <NumberField
              label="Bulgarian split squat load (kg)"
              value={draft.bulgarian_kg}
              onChange={(v) => setDraft({ ...draft, bulgarian_kg: v })}
            />
            <NumberField
              label="Front split left floor gap (cm)"
              value={draft.front_split_left_cm ?? 0}
              onChange={(v) => setDraft({ ...draft, front_split_left_cm: v })}
            />
            <NumberField
              label="Front split right floor gap (cm)"
              value={draft.front_split_right_cm ?? 0}
              onChange={(v) => setDraft({ ...draft, front_split_right_cm: v })}
            />
            <NumberField
              label="Middle split floor gap (cm)"
              value={draft.middle_split_cm ?? 0}
              onChange={(v) => setDraft({ ...draft, middle_split_cm: v })}
            />
          </>
        )}

        {step === 3 && (
          <>
            <label className="block text-sm">
              Pool length
              <select
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
                value={draft.pool_length_m}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    pool_length_m: Number(e.target.value) as 25 | 50,
                  })
                }
              >
                <option value={25}>25 m</option>
                <option value={50}>50 m</option>
              </select>
            </label>
            <label className="block text-sm">
              Comfortable bouldering grade
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
                value={draft.climbing_grade ?? ""}
                placeholder="e.g. V2"
                onChange={(e) =>
                  setDraft({ ...draft, climbing_grade: e.target.value || null })
                }
              />
            </label>
            <label className="block text-sm">
              Project grade
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
                value={draft.project_grade ?? ""}
                placeholder="e.g. V4"
                onChange={(e) =>
                  setDraft({ ...draft, project_grade: e.target.value || null })
                }
              />
            </label>
          </>
        )}

        {step === 4 && (
          <p className="text-sm text-muted">
            Default schedule: Mon/Wed/Sat primary · Tue/Thu/Fri short · Sun recovery.
            You can change days later in Settings without changing the training sequence.
          </p>
        )}
      </Card>

      <div className="mt-4 flex gap-3">
        {step > 0 ? (
          <SecondaryButton className="flex-1" onClick={() => setStep(step - 1)}>
            Back
          </SecondaryButton>
        ) : null}
        {step < steps.length - 1 ? (
          <PrimaryButton className="flex-1" onClick={() => setStep(step + 1)}>
            Continue
          </PrimaryButton>
        ) : (
          <PrimaryButton className="flex-1" onClick={finish}>
            Start training
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      {label}
      <select
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        type="number"
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
