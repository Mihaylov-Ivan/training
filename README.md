# Lifetime Athlete

Personal training + wellbeing tracker (local-first). Built from the Lifetime Athlete build specification: Today-first UX, data-driven routines, exact prescriptions, rest timers, and exercise-specific progression.

## Stack

- Next.js App Router + TypeScript + Tailwind
- Zustand (persisted local store)
- Zod / Vitest
- Supabase schema + RLS stubbed in `supabase/migrations` (not required to run)

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First visit runs onboarding, then `/today`.

```bash
npm test
npm run typecheck
npm run build
```

## Notes

- Workouts and progression rules live in `lib/seed/` and `lib/progression/` — not in React pages.
- Starting a session snapshots prescriptions into `session_items`.
- Rest timers use `rest_started_at` + duration (survives refresh).
- To connect Supabase later: copy `.env.example`, apply `supabase/migrations/0001_schema.sql`, and swap the local store for the SSR clients in `lib/supabase/`.
