# FEATURE: Adaptive Scheduling for Missed Workouts and Recovery Sessions

Update the Lifetime Athlete app so that the training schedule automatically and intelligently adapts whenever the user misses a workout, mobility session, skill session, swimming session, climbing session, or other scheduled activity.

The objective is NOT simply to move every missed activity to the next day.

The scheduling engine must protect:
- recovery between demanding workouts
- the intended order of the training programme
- high-frequency skill practice
- weekly workload
- deload weeks
- long-term progression
- user flexibility

The app should behave like an intelligent coach reorganising the programme.

---

# 1. Separate the training plan from the actual calendar

Do NOT modify the underlying workout templates when a workout is moved.

Maintain two separate concepts:

### Training template
The permanent programme definition.

Examples:
- Monday Strength + Power
- Wednesday Athleticism + Endurance
- Saturday Calisthenics Volume
- Tuesday Mobility
- Thursday Deep Flexibility
- Friday Recovery
- Week 2 Friday Swimming
- Week 3 Saturday Climbing

### Scheduled session instance
The actual dated occurrence of that workout.

Example:

Template:
`Monday Strength + Power`

Scheduled instance:
`Monday Strength + Power — originally 14 Sep — rescheduled to 15 Sep`

Suggested fields:

```ts
scheduled_session {
  id
  user_id
  workout_template_id
  original_date
  scheduled_date
  completed_at
  status
  reschedule_count
  missed_reason
  sequence_index
  cycle_week
  cycle_number
  is_deload
  auto_rescheduled
  manually_rescheduled
}
```

Possible statuses:

```ts
planned
in_progress
completed
partially_completed
missed
rescheduled
skipped
cancelled
```

This ensures that workout history always remembers what was originally planned while allowing the live schedule to change.

---

# 2. Ask why the session was missed

When the user marks a workout as missed, or when the app detects that a scheduled day has passed without completion, ask:

**Why did you miss this session?**

Use:

```ts
no_time
fatigue
poor_sleep
illness
pain_or_injury
travel
forgot
intentional_rest
other
```

The reason should influence scheduling.

For example:

`no_time` can normally trigger rescheduling.

`fatigue` should favour additional recovery.

`poor_sleep` should avoid putting a hard workout immediately the next day if another demanding session follows.

`illness` should pause progression and potentially initiate a return-to-training protocol.

`pain_or_injury` should NOT automatically reschedule the same demanding activity.

---

# 3. Different session types require different missed-session behaviour

The scheduling engine must classify every session.

```ts
MAIN_WORKOUT
SKILL_PRACTICE
MOBILITY_RECOVERY
DEEP_FLEXIBILITY
DAILY_MAINTENANCE
RUNNING
SWIMMING
CLIMBING
DELOAD_WORKOUT
```

Use the following rules:

| Session | If missed |
|---|---|
| Main 90-min workout | Reschedule if possible |
| Running inside Wednesday workout | Moves with Wednesday workout |
| OAHS / Planche micro-session | Do not make up |
| 30-min mobility | Usually skip rather than cram |
| Deep flexibility | May move by 1 day if recovery allows |
| Daily 5-min maintenance | Never make up |
| Swimming | Reschedule only if a suitable slot exists |
| Climbing | Move to another suitable Saturday/weekend slot |
| Deload workout | Do not compensate with extra volume |

The user should never be told to perform two missed OAHS sessions, two planche sessions or twice the stretching the following day.

Missed practice means missed practice.

Resume normally.

---

# 4. Main workout scheduling rules

The three core sessions are:

```text
A = Strength + Power
B = Athleticism + Endurance
C = Calisthenics Volume
```

Their intended order is:

```text
A → B → C → A → B → C
```

Maintain this order whenever reasonably possible.

Do NOT reorder them simply based on weekday names.

The user's physiological training sequence is more important than whether Strength happens specifically on Monday.

Example:

Original:

```text
Mon A
Wed B
Sat C
```

If Monday is missed:

```text
Tue A
Thu B
Sat C
```

is preferable.

Do NOT produce:

```text
Tue A
Wed B
Sat C
```

because the user would have consecutive demanding sessions.

---

# 5. Recovery constraint

There should normally be at least ONE non-main-workout day between major 90-minute sessions.

Preferred:

```text
Main → recovery/support day → Main
```

Avoid:

```text
Main → Main
```

unless the user explicitly overrides the recommendation.

Implement:

```ts
MIN_MAIN_SESSION_GAP = 1 calendar recovery day
```

The scheduling engine should evaluate downstream sessions when moving one workout.

Do not only move the missed workout.

Recalculate the upcoming schedule.

---

# 6. Example: Monday workout missed

Original:

```text
Mon Strength
Tue Mobility
Wed Athleticism
Thu Flexibility
Fri Recovery
Sat Calisthenics
Sun Rest
```

Monday is missed.

Automatically propose:

```text
Mon MISSED
Tue Strength
Wed Mobility / recovery
Thu Athleticism
Fri Recovery / mobility
Sat Calisthenics
Sun Rest
```

Thursday's normal flexibility work can be shortened or moved into Friday because Athleticism now occupies Thursday.

The user should see:

**Schedule adjusted**

Strength moved:
Monday → Tuesday

Athleticism moved:
Wednesday → Thursday

Thursday flexibility merged into Friday recovery.

Saturday remains unchanged.

---

# 7. Example: Wednesday workout missed

Original:

```text
Mon Strength
Tue Mobility
Wed Athleticism
Thu Flexibility
Fri Recovery
Sat Calisthenics
```

Preferred adjustment:

```text
Mon Strength
Tue Mobility
Wed MISSED
Thu Athleticism
Fri Recovery
Sat Calisthenics
```

Thursday Deep Flexibility is skipped or reduced because Athleticism takes priority.

Do NOT move everything automatically if the existing Saturday workout still has enough recovery separation.

---

# 8. Example: Saturday workout missed

Do not automatically place the full Saturday workout on Sunday if Monday Strength would then occur immediately afterward.

Preferred options:

```text
Sat missed
Sun Calisthenics
Mon recovery
Tue Strength
Thu Athleticism
Sat Calisthenics
```

OR, if preserving the calendar is more important:

Skip Saturday and resume Monday.

The app should calculate both options and recommend the option causing the least disruption.

Display:

**Recommended: Shift programme by one day**

or

**Recommended: Skip this session and resume normally**

The user can choose either.

---

# 9. Do not cram training

Never compensate for a missed workout by increasing:

- repetitions
- sets
- workout duration
- conditioning volume
- skill duration
- stretching duration

Do NOT create:

```text
Monday + Wednesday workout combined
```

Do NOT create:

```text
10 min OAHS tomorrow because today was missed
```

Do NOT create:

```text
double planche volume
```

A missed stimulus should usually be moved or skipped, never doubled.

---

# 10. Missed 30-minute mobility/recovery day

These sessions have lower scheduling priority.

If Tuesday mobility is missed and Wednesday Athleticism is still happening:

Do NOT move the entire Tuesday session to Wednesday.

Wednesday already contains:
- OAHS
- planche
- mobility after training

Therefore simply mark Tuesday missed and continue normally.

The history should retain the missed session.

The app can show:

**No rescheduling needed. Tomorrow's workout already includes skill and mobility work.**

---

# 11. Missed OAHS / Planche session

Never compensate.

If one practice session is missed:

```text
Monday ✓
Tuesday ✓
Wednesday MISSED
Thursday ✓
Friday ✓
Saturday ✓
```

That week simply contains five exposures.

Do NOT increase Thursday practice.

Progression calculations should use actual completed sessions rather than scheduled sessions.

---

# 12. Deep flexibility scheduling

Deep flexibility should not automatically be pushed into every free slot.

Normal deep sessions:

```text
Thursday
Saturday
```

If Thursday is lost because Athleticism was rescheduled:

Move the deep flexibility session to Friday only if:

```text
Friday is not immediately before unusually heavy lower-body training
AND
user recovery status is acceptable
```

Otherwise skip it.

One missed flexibility session is preferable to accumulating unnecessary fatigue.

---

# 13. Swimming rescheduling

Swimming is secondary to the three core workouts.

If the Week 2 Friday swim is missed:

Search the next 7 days for a suitable low-load slot.

Prefer:

```text
Sunday
Tuesday
Friday
```

but do not place a hard swim directly before a major Strength or Athleticism workout.

If no suitable slot exists:

Mark the swim skipped.

Do not displace a core workout merely to recover one missed swim.

---

# 14. Climbing rescheduling

Climbing normally replaces the Week 3 Saturday Calisthenics session.

If climbing is missed:

Allow it to move to:

```text
Sunday
next suitable weekend
```

but ensure it does not create excessive pulling/finger loading immediately before heavy weighted pull-ups or another climbing session.

If moved to Sunday:

Automatically change Monday Strength to Tuesday.

---

# 15. Progression must only respond to completed work

Missed sessions should NOT count as:

```text
failed progression
failed exercise
performance regression
```

Example:

Weighted Pull-up target:

```text
4 × 5 @ 20 kg
```

Monday workout missed.

The next Strength workout remains:

```text
4 × 5 @ 20 kg
```

Do NOT:
- increase weight
- reduce weight
- reset progression

The progression engine waits for actual performance data.

---

# 16. Partial workout completion

Partial workouts are different from missed workouts.

Store exercise-level results.

Example:

```text
OAHS ✓
Planche ✓
Muscle ups ✓
Weighted pullups ✓
HSPU FAILED
Bulgarian split squat NOT ATTEMPTED
```

Progress exercises independently.

Weighted pull-ups may progress.

HSPU stays at the same prescription.

Bulgarian split squat remains unchanged.

Workout-level progression must never blindly modify every exercise.

---

# 17. Multiple missed days

The system must recognise training interruptions.

### 1–2 missed days

Reorganise upcoming sessions normally.

### 3–6 consecutive missed days

Do not attempt to recover every missed session.

Resume the programme from the most logical next core workout.

Priority:

```text
preserve A → B → C sequence
```

Discard low-priority missed mobility/recovery sessions.

### 7–13 days without meaningful training

Create a temporary return week.

Main workouts:

```text
reduce working sets by 25%
```

Keep exercise difficulty and technique the same unless the user reports difficulty.

OAHS:

normal 5 min, but quality only.

Planche:

use light/medium protocol for first 3 exposures.

Running:

easy aerobic only for first session.

### 14+ days

Automatically suggest:

**Return-to-training week**

Use approximately:

```text
60–70% normal training volume
```

Then return to the normal programme if successfully completed.

Do not restart progression from zero.

---

# 18. Illness handling

If missed reason is:

```text
illness
```

do not continuously shift workouts forward.

Pause the programme.

Show:

**Training paused while recovering**

When the user chooses:

**I'm ready to train again**

calculate the interruption duration and apply the appropriate return-to-training week.

---

# 19. Pain/injury handling

If:

```text
missed_reason = pain_or_injury
```

do NOT automatically move the problematic workout.

Ask:

```text
Which body area caused the issue?
Which exercise/activity caused symptoms?
```

Store this information.

Flag relevant exercises.

Do not progress affected exercises until completed successfully again.

The app should not diagnose the injury.

---

# 20. Schedule recalculation engine

Create a function conceptually similar to:

```ts
recalculateSchedule({
  missedSession,
  upcomingSessions,
  trainingSequence,
  recoveryConstraints,
  cycleWeek,
  userAvailability,
  recentTrainingLoad
})
```

Return:

```ts
{
  updatedSessions,
  movedSessions,
  skippedSessions,
  mergedRecoverySessions,
  warnings,
  explanation
}
```

Every schedule change should be deterministic and explainable.

---

# 21. Schedule preview before applying

Never silently reorganise many days.

When a missed major workout changes future sessions, display a bottom sheet/modal.

Example:

```text
We adjusted your schedule

Tuesday
Strength + Power
Moved from Monday

Wednesday
Mobility + Recovery

Thursday
Athleticism + Endurance
Moved from Wednesday

Friday
Recovery

Saturday
Calisthenics Volume
Unchanged
```

Buttons:

```text
Apply Changes
Edit Schedule
Keep Original Schedule
```

For minor missed maintenance sessions, no confirmation is necessary.

---

# 22. Today's dashboard

Today's dashboard should always answer:

**What should I do today?**

It should not remain tied blindly to weekday templates.

If Monday Strength moved to Tuesday, Tuesday's main card must clearly say:

```text
TODAY

Strength + Power
Rescheduled from Monday

90 min
```

Underneath:

```text
Your schedule was adjusted because Monday's workout was missed.
```

---

# 23. Calendar visual states

Use clear visual states.

```text
Completed       ✓
Today           highlighted
Rescheduled     ↪
Missed          ×
Recovery        subtle
Future          normal
Deload          labelled
```

When a workout was moved:

Show its original date in the detail screen.

Example:

```text
Tuesday 15 September

Strength + Power

Originally scheduled:
Monday 14 September
```

---

# 24. History must never be rewritten

If Monday's workout was missed and moved to Tuesday:

History should contain:

```text
Monday:
Strength + Power
MISSED

Tuesday:
Strength + Power
COMPLETED
rescheduled_from: Monday
```

Do NOT simply edit Monday's database record into Tuesday and lose the missed history.

This is important for adherence analytics.

---

# 25. Track adherence separately from performance

Create metrics such as:

```text
planned_sessions
completed_sessions
missed_sessions
rescheduled_sessions
completed_after_reschedule
```

Show:

```text
Training adherence: 87%
Core workout adherence: 94%
Skill practice adherence: 81%
Mobility adherence: 76%
```

Rescheduling should not automatically count as failure.

Useful distinction:

```text
Scheduled adherence
Eventual completion rate
```

Example:

```text
Completed on planned date: 82%
Eventually completed: 94%
```

---

# 26. Preserve the 4-week training cycle

The training cycle should follow the completed/rescheduled programme intelligently.

Do not automatically begin Week 2 merely because the calendar entered the next Monday if Week 1 was heavily disrupted.

Store:

```ts
cycle_number
cycle_week
```

Normally cycle weeks correspond to calendar weeks.

However, if multiple core workouts shift substantially, allow the training cycle to shift with them.

The app should avoid situations where Week 3's overload workouts and Week 4's deload accidentally occur together because of rescheduling.

---

# 27. Deload protection

Week 4 exists for recovery.

Never move large amounts of Week 3 training into Week 4 in an attempt to catch up.

If a Week 3 workout cannot reasonably be completed:

Skip it.

Week 4 should remain a deload.

Never transform Week 4 into:

```text
Week 3 catch-up + Week 4 deload
```

---

# 28. User override

The recommendation engine advises but the user retains control.

Every moved workout should support:

```text
Move
Skip
Restore original date
Choose another day
```

If the user manually creates an aggressive schedule such as two major workouts on consecutive days, allow it but show:

**Recovery warning**

Do not block the action.

---

# 29. Automatic end-of-day handling

If a planned session has not started by the end of its scheduled day:

Change it to:

```text
pending_missed_confirmation
```

The next time the user opens the app, ask:

```text
You didn't log yesterday's Strength + Power workout.

What happened?
```

Options:

```text
I completed it
I partially completed it
I missed it
```

If completed, allow retrospective logging.

Do not automatically assume a workout was missed simply because no live workout timer was used.

---

# 30. Progression and schedule integration

The progression engine and scheduling engine must be separate.

Architecture:

```text
Training Plan
      ↓
Schedule Engine
      ↓
Scheduled Workout
      ↓
Workout Player
      ↓
Performance Result
      ↓
Progression Engine
      ↓
Next Prescription
      ↓
Future Scheduled Workouts
```

The scheduling engine answers:

**WHEN should I perform it?**

The progression engine answers:

**WHAT should I perform next time?**

Do not mix these responsibilities.

---

# 31. Important principle

The application should optimise for long-term consistency, not perfect calendar adherence.

The priority order is:

```text
1. User safety / recovery
2. Core workout sequence
3. Recovery between demanding workouts
4. Priority skill frequency
5. Strength/endurance progression
6. Flexibility progression
7. Swimming/climbing exposure
8. Exact weekday adherence
9. Making up missed low-priority sessions
```

Weekday names are flexible.

The training structure is not.

---

# 32. UX goal

The user should never need to manually calculate:

```text
I missed Wednesday, so should I train Thursday?
Then what happens Friday?
Can I still train Saturday?
Should swimming move?
Will my planche progression change?
```

The app should calculate this automatically and display one simple recommendation:

```text
TODAY

Athleticism + Endurance
90 min

Your programme has been adjusted.
Saturday remains unchanged.

START WORKOUT
```

The complexity should exist in the scheduling engine, not in the user interface.

---

# ACCEPTANCE TESTS

Before considering this feature complete, implement automated tests for at least these scenarios:

```text
Monday main workout missed
Wednesday main workout missed
Saturday main workout missed
Tuesday mobility missed
Thursday flexibility missed
Friday swimming missed
Saturday climbing missed
one OAHS session missed
three consecutive days missed
seven days missed
fourteen days missed
illness interruption
injury interruption
partially completed workout
workout logged one day late
Week 3 workout missed immediately before deload week
user manually overrides automatic recommendation
```

Every test should verify:

```text
correct workout order
adequate recovery
no duplicated sessions
no accidental progression from missed work
correct history preservation
correct cycle/week handling
```

The final system should feel like an adaptive personal coach rather than a static weekly calendar.