# Mobile Optimization Plan — One Percent

_Goal: make the app fast and frictionless on a phone (~360–430px), held one-handed, for **easy and frequent daily use**. The core daily loop is: open app → see today's habits on the Launchpad → press-and-hold to cast a vote._

Audited every screen + the global shell. Overall: the daily loop **works but has one critical bug**; forms and modals are **poor on mobile** (iOS zoom, unreachable buttons); and the two biggest levers for daily habit use — **install-to-home-screen and reminders — are currently disabled.**

## Readiness by surface

| Surface | Readiness | Worst issues |
|---|---|---|
| Launchpad + HabitCard (daily loop) | Fair | Hold-to-vote cancelled by scroll; grid overflow at 360px; 3s hold too long |
| Architect (create habit) | Poor | Every field iOS-zooms; Save buried at bottom, not sticky |
| Habit Coach | Fair | `100vh` + no safe-area → input hidden behind keyboard/nav; rename/delete are hover-only (unreachable on touch) |
| Auth / Landing / Settings / Modals | Poor | All inputs zoom on focus; modals have no scroll → Submit off-screen |
| Momentum | Good | Heatmap tooltips are hover-only (no touch) — minor |
| Vision Canvas | Fair | React-Flow panels/controls hidden behind the fixed bottom nav; image add is desktop drag-drop only |
| Global shell / PWA | Poor (strategic) | PWA self-destructing (not installable); no reminders |

---

## Highest-leverage global fixes (do first — each fixes many screens at once)

1. **Kill iOS input-zoom app-wide.** Any input/textarea under 16px makes iOS auto-zoom on focus. One global rule fixes ~7 findings at once (Auth, Settings, Architect's ~10 fields, Atomizer, AIChat, Coach textarea + rename, both modals):
   ```css
   /* client/src/index.css */
   @media (max-width: 640px) { input, textarea, select { font-size: 16px; } }
   ```
   (Shared `Input`/`Textarea` are `text-sm` = 14px — [Input.tsx:23](client/src/components/ui/Input.tsx#L23), [Textarea.tsx:23](client/src/components/ui/Textarea.tsx#L23).)

2. **Safe-area + dynamic viewport height.** `viewport-fit=cover` is already set. Add `padding-bottom: env(safe-area-inset-bottom)` to the fixed mobile bottom bar ([Layout.tsx:57](client/src/components/layout/Layout.tsx#L57)) and the `Modal`. Replace `100vh` with `100dvh` so layouts don't break when the address bar/keyboard appears: Coach `h-[calc(100vh-7rem)]` → `dvh` ([HabitCoach.tsx](client/src/pages/HabitCoach.tsx)), Auth/Landing `min-h-screen` → `min-h-[100dvh]`. (Canvas already uses `dvh`.)

3. **Tap targets ≥ 44px.** Shared `Input`/`Button` are `h-9` (36px). Bump to `h-11` on mobile; pad icon-only buttons (edit pencil, modal X, remove-phase, coach drawer X).

4. **Modals must scroll.** `Modal` panel has no max-height → the Automaticity Check and Next Phase Submit buttons get pushed off-screen. Add `max-h-[90dvh] overflow-y-auto` (+ optional sticky footer). Fixes both modals at once.

5. **One source of truth for nav.** Desktop sidebar and mobile bottom bar now agree on `Momentum`. Still to reconcile: where Architect/Canvas/Settings live on mobile.

---

## Phase 1 — Critical daily-loop fixes ✅ SHIPPED (2026-06-20)

_All items below deployed. The global 16px input rule needed `!important` to beat Tailwind's `text-*` class specificity (verified live: the Auth email input now computes to 16px at 375px width, no horizontal overflow). Also applied `dvh` to the Auth + Landing entry screens._


- **Hold-to-vote scroll-cancel (CRITICAL).** The vote button has no `touch-action`, so a thumb-hold on a scrollable list is claimed as a scroll and `onPointerCancel` aborts the vote. Add `touch-none` to the vote button ([HabitCard.tsx:286](client/src/components/habit/HabitCard.tsx#L286)). This is the single most important fix — the app's one action silently fails today.
- **Shorten the hold:** `HOLD_MS` 3000 → ~1300 ([HabitCard.tsx:19](client/src/components/habit/HabitCard.tsx#L19)). 3s × up to 6 habits/day is fatiguing and worsens the scroll collision.
- **Grid overflow:** `minmax(330px, 1fr)` → `minmax(min(100%, 330px), 1fr)` ([Launchpad.tsx:84](client/src/pages/Launchpad.tsx#L84)) so a single column always fits a 360px screen.
- Global **16px input** fix (#1 above).
- **Modal scroll** fix (#4 above) — unblocks completing the Automaticity Check / advancing a phase on mobile.
- **Safe-area** on bottom nav + **dvh** on Coach (#2 above) so the chat input isn't hidden behind keyboard/nav.

## Phase 2 — High-impact friction ✅ SHIPPED (2026-06-20)

_All items below deployed. Tap targets verified live (Auth input now 41px `h-11` + 16px). The Goldilocks calibration is now a viewport bottom sheet on mobile (backdrop + Skip), in-card slide-up on desktop. Note: nav reconciliation (which items appear in the mobile bottom bar — Architect/Settings are currently absent) was left out as it needs a product decision; see "Still open" below._


- **Architect sticky save bar** on mobile — the form is 5 long sections; the only Save is at the very bottom ([Architect.tsx:659](client/src/pages/Architect.tsx)). Pin a bottom action bar (with safe-area).
- **Stack page headers on mobile** so the action button drops below the greeting (Launchpad "Engineer a habit"; Coach title) and reclaim vertical space.
- **Goldilocks "how did that feel?" sheet** → render as a viewport-anchored bottom sheet with a dismiss/skip affordance; today it's pinned inside the card and can be off-screen with no way out ([HabitCard.tsx:345](client/src/components/habit/HabitCard.tsx#L345)).
- **Coach rename/delete are `group-hover` only** → unreachable on touch ([HabitCoach.tsx:227](client/src/pages/HabitCoach.tsx)). Make them always-visible (or long-press) on mobile; add Escape/focus-trap to the drawer.
- **Tap-target pass:** coach suggestion chips (~36px), SRBAI score buttons (`h-9`), text links (sign-in toggle, Undo, Cancel/Later).
- **Add-a-habit tile** `min-h-[300px]` → smaller on mobile ([Launchpad.tsx:99](client/src/pages/Launchpad.tsx)).
- **Canvas:** lift React-Flow `Controls` and the bottom-center action panel above the fixed nav; add a tap/long-press way to add an image (drag-drop is desktop-only).

## Phase 3 — Strategic for "frequent daily use" (project-sized, highest retention payoff)

_Status (2026-06-20): **PWA installability ⛔ REVERTED** — the precaching service worker shipped briefly but caused a stale-asset regression (an old cached `index.html` referenced deleted CSS hashes → fully unstyled app on update). Rolled back to the self-destructing SW (clears caches, always loads fresh from network). Icons/manifest/favicons remain in the repo for a future, more careful attempt (use a SW update-prompt flow + verify the update path before shipping). **Haptics on vote ✅ shipped** (`navigator.vibrate`). **Architect removed from desktop sidebar ✅** (created from the Launchpad). **FCM daily reminders ⏳ not yet** — see prerequisites below; note iOS web push needs an installed PWA, so reminders + a careful PWA re-attempt should land together. **Offline vote queue ⏳ not yet**._

**FCM reminder prerequisites (need before building):** (1) a Web Push **VAPID key** from Firebase Console → Project Settings → Cloud Messaging (and ensure the API is enabled); (2) a product decision on default reminder time + copy + per-user time setting (timezone-aware); (3) a scheduled Cloud Function (Cloud Scheduler) to send the daily nudge, plus a table/field for FCM tokens and a `firebase-messaging-sw.js`. iOS web push requires the app be installed as a PWA first — which is now possible.


- **Re-enable the PWA** (currently `VitePWA({ selfDestroying: true })` in [vite.config.ts](client/vite.config.ts) — it actively unregisters itself). Ship a real manifest + icons + offline app-shell so the app installs to the home screen with its own icon. A habit app lives or dies by being one tap away.
- **Daily reminders / push notifications** — there is currently **no nudge mechanism at all**, and reminders are the #1 driver of daily return for a habit app. Natural fit: **Firebase Cloud Messaging** (you're already on Firebase). Note: iOS web push requires the installed PWA, so this depends on the step above.
- **Haptic feedback** on a completed vote (`navigator.vibrate`) — cheap delight on the core action.
- **Offline vote queue** — TanStack Query already persists reads, so today's habits show offline; queue the vote mutation so casting works on the subway and syncs later.

---

## Recommended sequence

Do **Phase 1 first** — it's the best impact-to-effort ratio (almost all one-line CSS) and fixes the one genuinely broken thing (voting). Then Phase 2 (form/coach ergonomics). Phase 3 is where "frequent daily use" is really won (install + reminders) and deserves its own scoped build.
