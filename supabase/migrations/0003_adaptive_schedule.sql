-- Adaptive scheduling fields for missed / rescheduled sessions

alter table public.scheduled_sessions
  add column if not exists original_date date,
  add column if not exists completed_at timestamptz,
  add column if not exists reschedule_count int not null default 0,
  add column if not exists missed_reason text,
  add column if not exists sequence_index int not null default 0,
  add column if not exists cycle_number int not null default 1,
  add column if not exists is_deload boolean not null default false,
  add column if not exists auto_rescheduled boolean not null default false,
  add column if not exists manually_rescheduled boolean not null default false,
  add column if not exists rescheduled_from_id uuid references public.scheduled_sessions (id) on delete set null,
  add column if not exists missed_note text,
  add column if not exists injury_area text,
  add column if not exists injury_exercise text;

update public.scheduled_sessions
set original_date = date
where original_date is null;

update public.scheduled_sessions
set is_deload = (cycle_week = 4)
where is_deload = false and cycle_week = 4;

alter table public.scheduled_sessions
  alter column original_date set default null;

create index if not exists scheduled_sessions_date_idx
  on public.scheduled_sessions (user_id, date);

create index if not exists scheduled_sessions_status_idx
  on public.scheduled_sessions (user_id, status);
