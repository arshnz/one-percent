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

Run the web app's own TypeScript over your real data plus 300 randomised schedules, then check the Swift against it:

```bash
TZ=Pacific/Auckland npx tsx ios/Tools/golden.ts backups/ios-export-2026-10-29.json
xcodebuild -project ios/OnePercent.xcodeproj -scheme OnePercent \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test
```

The fixtures hold personal data, so they're gitignored, and the tests skip themselves when the fixtures are missing. Every piece of ported logic gets a section in `golden.ts`.

## Known quirks carried over on purpose

- **Compound curve, creation day.** The curve cuts `createdAt`, `pausedAt` and `archivedAt` to the *UTC* date, while everything else uses the local date. In NZ that means a habit created before 1pm counts from the previous day on the curve only. This is kept identical so imported history reads the same; fix it in both places at once, or not at all.
- **Server-side `localWeekStartMonday`** formats a local-noon Date with `toISOString()`. That's only correct when the process runs in UTC (Cloud Functions did). The Swift port uses `LocalDate.mondayOf`, which doesn't have the problem.
