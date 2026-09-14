-- Run this in the Supabase SQL editor AFTER using the app with Auth.
-- (You already applied 0001; apply this next.)

-- Hybrid sync: keep TS seed catalog locally; store text catalog refs in user tables.

alter table public.training_sessions
  add column if not exists cycle_week int not null default 1,
  add column if not exists overview_seen boolean not null default false;

alter table public.session_items
  add column if not exists exercise_slug text,
  add column if not exists exercise_name text,
  add column if not exists block text,
  add column if not exists progression_rule_code text,
  add column if not exists progression_scope text;

-- progression_state_snapshot may already exist from 0001
alter table public.session_items
  add column if not exists progression_state_snapshot jsonb;

alter table public.progression_events
  add column if not exists rule_code text,
  add column if not exists next_prescription_preview text;

alter table public.progression_states
  add column if not exists current_level text;

alter table public.scheduled_sessions
  drop constraint if exists scheduled_sessions_routine_template_id_fkey;

alter table public.training_sessions
  drop constraint if exists training_sessions_routine_template_id_fkey;

alter table public.session_items
  drop constraint if exists session_items_exercise_id_fkey;

alter table public.progression_events
  drop constraint if exists progression_events_rule_id_fkey;

alter table public.scheduled_sessions
  alter column routine_template_id type text using routine_template_id::text;

alter table public.training_sessions
  alter column routine_template_id type text using routine_template_id::text;

alter table public.session_items
  alter column exercise_id type text using exercise_id::text;

alter table public.session_items
  alter column routine_item_id type text using routine_item_id::text;
