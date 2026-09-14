-- Lifetime Athlete schema + RLS (for future Supabase wiring)
-- Spec §9

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Athlete',
  units text not null default 'metric',
  timezone text not null default 'UTC',
  smallest_load_increment_kg numeric not null default 1.0,
  pool_length_m int not null default 25,
  equipment jsonb not null default '{}'::jsonb,
  onboarding_complete boolean not null default false,
  timer_sound boolean not null default true,
  timer_haptics boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.capability_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  priority int not null default 0,
  target_text text,
  active boolean not null default true
);

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null,
  metric_type text not null,
  instructions text not null,
  cues jsonb not null default '[]'::jsonb,
  common_mistakes jsonb not null default '[]'::jsonb,
  media_url text,
  progression_family text
);

create table if not exists public.exercise_levels (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercise_library (id) on delete cascade,
  ordinal int not null,
  name text not null,
  parameters jsonb not null default '{}'::jsonb,
  next_level_id uuid
);

create table if not exists public.progression_rules (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  version int not null default 1,
  rule_json jsonb not null default '{}'::jsonb,
  description text
);

create table if not exists public.routine_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  kind text not null,
  default_duration_min int not null,
  description text,
  active boolean not null default true
);

create table if not exists public.routine_items (
  id uuid primary key default gen_random_uuid(),
  routine_template_id uuid not null references public.routine_templates (id) on delete cascade,
  exercise_id uuid not null references public.exercise_library (id),
  sequence int not null,
  block text not null,
  prescription jsonb not null,
  rest_seconds int not null default 0,
  progression_rule_id uuid references public.progression_rules (id),
  progression_scope text
);

create table if not exists public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cycle_number int not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'active'
);

create table if not exists public.scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  routine_template_id uuid not null references public.routine_templates (id),
  cycle_week int not null,
  day_role text not null,
  status text not null default 'scheduled',
  generated_from_schedule boolean not null default true
);

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scheduled_session_id uuid references public.scheduled_sessions (id),
  routine_template_id uuid not null references public.routine_templates (id),
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'planned',
  readiness_snapshot jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.session_items (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions (id) on delete cascade,
  routine_item_id uuid,
  exercise_id uuid not null references public.exercise_library (id),
  sequence int not null,
  prescription_snapshot jsonb not null,
  progression_state_snapshot jsonb,
  status text not null default 'pending'
);

create table if not exists public.set_results (
  id uuid primary key default gen_random_uuid(),
  session_item_id uuid not null references public.session_items (id) on delete cascade,
  set_index int not null,
  prescribed jsonb not null,
  actual jsonb not null,
  started_at timestamptz,
  completed_at timestamptz,
  success boolean,
  note text
);

create table if not exists public.exercise_results (
  id uuid primary key default gen_random_uuid(),
  session_item_id uuid not null references public.session_items (id) on delete cascade,
  completed_all boolean not null,
  difficulty int,
  pain_score int,
  note text,
  metrics jsonb not null default '{}'::jsonb,
  idempotency_key text unique
);

create table if not exists public.progression_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope_type text not null,
  scope_id text not null,
  current_level_id uuid,
  state jsonb not null default '{}'::jsonb,
  success_credits int not null default 0,
  consecutive_successes int not null default 0,
  consecutive_failures int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, scope_type, scope_id)
);

create table if not exists public.progression_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_item_id uuid references public.session_items (id),
  rule_id uuid references public.progression_rules (id),
  event_type text not null,
  before jsonb not null,
  after jsonb not null,
  explanation text,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create table if not exists public.wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  sleep_quality_1_5 int not null,
  energy_1_5 int not null,
  soreness_0_10 int not null,
  neck_pain_0_10 int not null,
  back_pain_0_10 int not null,
  notes text,
  unique (user_id, date)
);

create table if not exists public.performance_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  metric_code text not null,
  value_numeric numeric not null,
  unit text not null,
  side text,
  measured_at timestamptz not null default now(),
  context jsonb not null default '{}'::jsonb
);

create table if not exists public.user_schedule_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  weekday_map jsonb not null default '{}'::jsonb,
  reminder_preferences jsonb not null default '{}'::jsonb
);

-- RLS
alter table public.profiles enable row level security;
alter table public.capability_goals enable row level security;
alter table public.training_cycles enable row level security;
alter table public.scheduled_sessions enable row level security;
alter table public.training_sessions enable row level security;
alter table public.session_items enable row level security;
alter table public.set_results enable row level security;
alter table public.exercise_results enable row level security;
alter table public.progression_states enable row level security;
alter table public.progression_events enable row level security;
alter table public.wellbeing_checkins enable row level security;
alter table public.performance_measurements enable row level security;
alter table public.user_schedule_preferences enable row level security;
alter table public.routine_templates enable row level security;
alter table public.routine_items enable row level security;
alter table public.exercise_library enable row level security;
alter table public.progression_rules enable row level security;

create policy "users read own profiles" on public.profiles for select using (auth.uid() = user_id);
create policy "users update own profiles" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users insert own profiles" on public.profiles for insert with check (auth.uid() = user_id);

create policy "users own capability_goals" on public.capability_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own training_cycles" on public.training_cycles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own scheduled_sessions" on public.scheduled_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own training_sessions" on public.training_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own progression_states" on public.progression_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own progression_events" on public.progression_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own wellbeing_checkins" on public.wellbeing_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own performance_measurements" on public.performance_measurements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own schedule_prefs" on public.user_schedule_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users read own session_items" on public.session_items for select
  using (exists (select 1 from public.training_sessions ts where ts.id = training_session_id and ts.user_id = auth.uid()));
create policy "users write own session_items" on public.session_items for all
  using (exists (select 1 from public.training_sessions ts where ts.id = training_session_id and ts.user_id = auth.uid()))
  with check (exists (select 1 from public.training_sessions ts where ts.id = training_session_id and ts.user_id = auth.uid()));

create policy "users read own set_results" on public.set_results for select
  using (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ));
create policy "users write own set_results" on public.set_results for all
  using (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ));

create policy "users read own exercise_results" on public.exercise_results for select
  using (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ));
create policy "users write own exercise_results" on public.exercise_results for all
  using (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.session_items si
    join public.training_sessions ts on ts.id = si.training_session_id
    where si.id = session_item_id and ts.user_id = auth.uid()
  ));

-- System catalog readable by authenticated users
create policy "auth read exercise_library" on public.exercise_library for select to authenticated using (true);
create policy "auth read progression_rules" on public.progression_rules for select to authenticated using (true);
create policy "auth read system routines" on public.routine_templates for select to authenticated
  using (user_id is null or user_id = auth.uid());
create policy "auth read routine_items" on public.routine_items for select to authenticated using (true);
