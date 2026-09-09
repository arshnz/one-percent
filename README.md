# One Percent

A single-user habit engine built on the mechanics of James Clear's *Atomic Habits*.
Shares the design language of the ToDo app (`../ToDo`).

> **Status:** All four screens built (Launchpad, Architect, Momentum,
> Vision Canvas), plus the science-based upgrades — Automaticity Check (SRBAI)
> graduation, Architect validation, and the Rhythm+Anchoring Consistency score.
> The three automations (Midnight Sweep, Never Miss Twice, Nightstand Check) are
> planned next. See
> `~/.claude/plans/project-handover-specification-vision-to-humble-bonbon.md`.

## Stack

- **Client:** React + Vite + TypeScript + Tailwind (same tokens/fonts as ToDo)
- **Server:** Express + Prisma + PostgreSQL
- **Auth:** Firebase (shares the ToDo app's Firebase project)
- **DB:** Reuses the ToDo app's Supabase Postgres instance, isolated in a
  dedicated `habit` Postgres schema so the two apps never collide.

## Quick start

```bash
npm run setup   # install + sync DB schema (prisma db push) — first time only
npm run dev     # client on :5173, server on :3001
```

Create an account on first launch, open **The Architect** to engineer a habit,
then cast your votes on **The Launchpad**.

## What's built

| Screen | Status |
|---|---|
| The Launchpad — daily cards, Main Target button, Fail-Safe switch, Goldilocks reflection, confetti | ✓ |
| The Architect — Why Board, strict implementation-intention template, Just-in-Time Phase Mapper (permanent fail-safe + Phase 1, future phases locked) | ✓ |
| Habit editing (click any habit → edit fields + current-phase target) & multiple habits | ✓ |
| Vision Canvas — drag-and-drop images (files compressed to data URLs, or dragged URLs) | ✓ |
| Momentum — the compound curve, Total Identity Votes, **Consistency (Rhythm + Anchoring)**, **per-habit heatmaps**, phase-climb trajectory (no streaks) | ✓ |
| Max 3 active habits (archive one to add another) | ✓ |
| The Vision Canvas — infinite spatial board (React Flow) with note/quote/image nodes, drag persistence, Convert to Habit Blueprint → Architect prefill | ✓ |
| **Automaticity Check (SRBAI)** — rep floor unlocks a 4-item self-report; passing graduates the phase and prompts the next | ✓ |
| **Architect validation** — fail-safe brevity warning + ≤2-min confirmation, concrete-cue nudge | ✓ |
| Midnight Sweep / Never Miss Twice / Nightstand Check | Planned |

## Notes

- `npm run db:migrate` runs `prisma db push` (not `migrate dev`) because the
  shared Supabase database is non-empty; push syncs only the `habit` schema and
  needs no migration-history baseline.
- Each completed rep — full Target or 2-minute Fail-Safe — counts as one
  **Identity Vote**. Phases graduate automatically once their rep count is met.
