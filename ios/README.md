# One Percent — native iOS

SwiftUI + SwiftData, on-device. No server: this replaces the web app, Firebase and Postgres.

## Build

```bash
brew install xcodegen          # once
cd ios && xcodegen generate    # after adding/removing files or editing project.yml
open OnePercent.xcodeproj
```

`project.yml` is the source of truth. The `.xcodeproj` is generated and gitignored.

## Bringing data across

1. Export from the live database (needs `server/.env.local`):
   `cd server && npx tsx src/scripts/exportForIos.ts <email>` writes `backups/ios-export-<date>.json`.
2. In the app, tap **Import my data** and pick that file. You can AirDrop it or put it in iCloud Drive.

In the simulator, skip the picker by passing launch arguments: `-importPath /abs/path/export.json`, optionally with `-eraseFirst`.

## Golden tests: is the port actually like-for-like?

`ios/Tools/golden.mts` runs the web app's **own code** over your exported data and writes what it produced. That covers the pure libraries (schedule, compound curve) and the **real Express route handlers** (`/habits/today`, `/checkins/current`, and every write route). The Swift tests then require identical output.

```bash
TZ=UTC HARNESS_NOW=2026-10-29T03:00:00Z \
  node --import tsx --import ./ios/Tools/harness/register.mjs \
  ios/Tools/golden.mts backups/ios-export-2026-10-29.json
xcodebuild -project ios/OnePercent.xcodeproj -scheme OnePercent \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test
```

How the harness works (`ios/Tools/harness/`):

- `register.mjs` swaps `server/src/lib/prisma` for an in-memory Prisma stand-in (`prismaStub.cts`) and pins the clock (`HARNESS_NOW`, movable mid-run).
- `routes.mts` calls a router's handler directly, so there's no HTTP and no auth.

The stub throws on any query shape it doesn't support, so a route that grows a new query fails loudly instead of quietly returning the wrong rows.

The coverage today:

- 300 randomised schedules
- your real habits plus three synthetic ones (a phase ladder, a taper habit, a weekly quota)
- 83 moments across ten weeks of history
- a 26-step scripted run of votes, edits, reasons, Automaticity Checks and check-ins

The fixtures hold personal data, so they're gitignored, and the tests skip themselves when the fixtures are missing.

## AI

There's no server and no API key. Every AI surface runs on Apple's models through Foundation Models: the coach, the blueprint interview and draft, the Compass helper and "pull into the form", the check-in companion and summary, and Momentum insights.

- **On-device** (default) needs an iPhone 15 Pro or newer with Apple Intelligence on. Its context is small (about 4k tokens), so packs and book passages are trimmed for it (`AIEngine.promptBudget`).
- **Private Cloud Compute** (iOS 27) is much stronger but needs Apple's managed entitlement `com.apple.developer.private-cloud-compute`, which you request at https://developer.apple.com/contact/request/private-cloud-compute/. Without it the model reports itself available and then traps on first use. Once it's granted, add the entitlement to the target and set `OPUsePrivateCloudCompute: true` in `project.yml`.
- **The Simulator can't run either model.** Test the AI on a device. In the Simulator the app says so and offers hand-off.
- **Hand-off**, on every surface, copies or shares the full prompt (role, your context, the conversation) for Claude or any assistant. You can then paste the answer back in: a chat reply, blueprint JSON, Compass JSON, or insights.

The prompts and data packs are word-for-word ports of `routes/ai.ts`. The golden harness swaps `@google/generative-ai` for a recorder (`harness/geminiStub.cts`) and checks the Swift prompts against what the web actually sent. The coach's book retrieval moved from Gemini embeddings plus pgvector to Apple's on-device sentence embeddings, computed in the background on first launch.

## Known quirks carried over on purpose, and the one fixed

- **Compound curve, creation day.** The curve cuts `createdAt`, `pausedAt` and `archivedAt` to the *UTC* date, while everything else uses the local date. In NZ that means a habit created before 1pm counts from the previous day on the curve only. This is kept identical so imported history reads the same; fix it in both places at once, or not at all.
- **Server-side `localWeekStartMonday`** formats a local-noon Date with `toISOString()`. That's only correct when the process runs in UTC (Cloud Functions did). The Swift port uses `LocalDate.mondayOf`, which doesn't have the problem.
- **Fixed: votes while a phase is `ready`.** The web log route attached them to "active, else the highest-numbered phase". With a locked step above, that credited a phase you hadn't reached with reps. iOS logs to the phase the Today card shows, which is the ready one. The golden scenario doesn't vote during `ready`, so this difference is deliberate and untested against the web.
