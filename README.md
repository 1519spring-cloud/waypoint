# Waypoint: an offline training and eating coach for iPhone

Built 2026-09-23 for Hilary. A Progressive Web App (PWA), built the same way as Daybook: install it once from Safari and it runs from the Home Screen with no network. Everything (workouts, food, weigh-ins, check-ins) lives only on the phone in IndexedDB. No account, no server, no tracking.

Goals it is built around: lose weight, gain strength and flexibility, and protect the low back, hips, knees and shoulders. Equipment it programs for: body weight, mat, dumbbells, bands, bench, rowing machine, treadmill, road and trail running, bathroom scale.

## Market scan (September 2026)

| App | Price | Best at | Export |
|---|---|---|---|
| Fitbod | $12.99 to $15.99/mo or $79.99 to $95.99/yr | Auto-generated strength workouts, recovery-aware | No CSV export found |
| Hevy | Free tier; Pro about $23.99/yr or $74.99 lifetime (third-party figures) | Fast lifting log, social feed | CSV |
| Strong | Free tier; Pro $29.99/yr or lifetime | Minimal lifting log | CSV |
| Future | About $199/mo | Human coach, Apple Watch check-ins | Not confirmed |
| MacroFactor | $71.99/yr | Adaptive calorie target from weight trend plus intake | Not confirmed |
| Cronometer | Free; Gold $59.99/yr | Micronutrients | CSV |
| Runna | $119.99/yr | Adaptive run plans | Not confirmed |
| Apple Fitness+ | $79.99/yr | Video classes tied to the Watch | Through Apple Health only |
| Pliability | $179.99/yr | Guided mobility sessions and a mobility test | Not confirmed |

Sources: vendor pricing pages and App Store listings, checked 2026-09-23 by a research pass; Hevy and Future figures came from third-party reviews because their own pages did not load. Prices change often.

Features reviewers call state of the art, and what Waypoint does with each:

- Adaptive energy expenditure (MacroFactor): Waypoint smooths daily weigh-ins into a trend and, after two weeks of logging, back-calculates what you actually burn.
- Auto-progression (Fitbod, Hevy): double progression on every lift, gated by technique rating, reps in reserve, pain, and the next-morning 24-hour rule.
- Recovery-aware adjustment: a 30-second morning check-in turns the day green, yellow or red and swaps exercises around an achy joint.
- Wearable integration: Apple Health export import (workouts, weight, resting heart rate, VO2 max).

What no app in the scan does, and Waypoint does: builds the whole program around a back-rehab ladder (the four levels from the June 2026 Low-Back Rehab program) and the 24-hour rule, with the McGill Big 3 built into every strength day.

## Features

**Today**
- Morning check-in: sleep, energy, soreness, back pain 0 to 10, achy joints, the 24-hour question ("compared with yesterday morning"), and a red-flag list. Result: green, yellow (adjusted or swapped), red (recovery day), or stop (see a doctor).
- Today's session with a Start button, a different-session picker, and "log other activity."
- Spine and hips daily: guided Big 3 plus six mobility drills with voice cues (about 18 minutes including rests; a "Mark done" button for when you do it on your own).
- Weigh-in with a trend line; calorie and protein rings.

**Train**
- Weekly schedule (default): Mon strength A (hinge, hips), Tue Zone 2, Wed strength B (upper, shoulders), Thu 4x4 intervals, Fri strength C (squat, knees), Sat long run or hike, Sun recovery mobility. Every day can be reassigned.
- Session player: set logging (pounds, reps, reps in reserve), automatic rest timer, per-exercise technique and pain ratings, swap button, hold timer for timed exercises.
- Progression chains per slot (for example: hip hinge with dowel, then dumbbell Romanian deadlift, then B-stance, then single-leg). A movement moves to the next step after two sessions at the top of the range with good technique; pain of 4 or more steps it back.
- Back readiness levels 1 to 4 decide which movements and how much impact get programmed. Level 3 includes the return-to-run checklist and a 9-stage walk-run ladder.
- Cardio: Zone 2 and interval heart-rate targets from the Tanaka max-heart-rate formula (208 − 0.7 × age), guided interval timer, and a long-run cap at 10% over the longest run of the past 30 days.
- Deload every 6th week.

**Food**
- Protein and calorie targets. Default: lose 0.5% of body weight per week; protein 1.6 g per kg of goal weight.
- Quick add, recent foods, saved foods, copy yesterday.
- Barcode scan (camera) and barcode lookup through Open Food Facts; text search of Open Food Facts. Both need a connection; saved foods work offline.

**Progress**
- Weight and trend, 14-day calories and protein, energy estimate details, back pain from check-ins.
- Training minutes per week against the 150-minute guideline, estimated one-rep max per lift.
- Cardio minutes, longest recent run, resting heart rate and VO2 max from Apple Health.
- Fitness and mobility tests every four weeks: waist, resting heart rate, side plank each side, push-ups, toe touch, knee-to-wall each side, wall overhead reach, hip-flexor test, eyes-closed balance, sit-to-stand, 2,000 m row, 1-mile run.

**Learn**
- 55 movements, each with setup, steps, cues, common mistakes, joint notes, a joint-stress rating for back, hip, knee and shoulder, and its place in the progression chain. 51 have an animated side-view figure.
- New movements start in Learning mode: guide card, a light practice set, and no weight increases until technique is rated 4 or 5 twice.
- Form check: film a set with the phone camera and replay it at half speed next to the cues. Nothing is saved or uploaded.
- Guides: neutral spine and bracing, the 24-hour rule, red flags, reps in reserve, learning a movement, Zone 2 and 4x4, running without getting hurt, losing fat while keeping muscle.

**Data**
- Backup to a JSON file (Save to Files), restore by merging, CSV export (daily, sets, sessions, food, tests) as a zip.
- Reminder banner when the last backup is more than 14 days old.
- Light and dark mode.

## What was tested (Chromium, iPhone 13 viewport)

Onboarding; check-in with a joint flag (swaps applied, sets not reduced); strength session logging, finish, and progression messages; Big 3 and daily-routine guided timers; cardio plan, interval timer and logging; quick-add food; progress charts; exercise detail with animation; swap sheet; tests entry; Apple Health import of a synthetic 13.7 MB export.xml in the current Health format (41 workouts, 40 weigh-ins, resting heart rate, VO2 max) and re-import with no duplicates; backup and restore into a clean browser; CSV export; reload with the network off (app loads from cache). Barcode lookup was tested against the live Open Food Facts API from the build machine, and offline handling in the browser. No JavaScript errors.

Not tested: a physical iPhone, the camera barcode scanner, voice cues through the phone speaker, and a real Apple Health export.

## Install on the iPhone

Same as Daybook:

1. Host the folder at an HTTPS address once (GitHub Pages is free; see below).
2. Open that address in Safari on the iPhone.
3. Tap Share, then Add to Home Screen.
4. Open Waypoint from the Home Screen icon. After that it needs no network, except for food search and barcode lookups.

Use the Home Screen app, not a Safari tab: WebKit exempts Home Screen web apps from Safari's 7-day storage cleanup.

### GitHub Pages hosting

1. Create a public repository named `waypoint`.
2. Upload every file in this folder: `index.html`, `figure.js`, `data.js`, `engine.js`, `app.js`, `app2.js`, `app3.js`, `sw.js`, `manifest.webmanifest`, `jszip.min.js`, `zxing.min.js` and the `icons` folder.
3. Settings > Pages > Deploy from branch `main`, folder `/ (root)`.
4. The app is served at `https://<username>.github.io/waypoint/`.

The code is public; your data never leaves the phone.

## Apple Watch data

Waypoint cannot read Apple Health directly (only native apps can). To bring Watch data in:

1. iPhone Health app > profile picture > Export All Health Data. This makes `export.zip`.
2. Save it to Files. Tap it in the Files app to unzip.
3. In Waypoint: Settings > Import from Apple Health > pick `apple_health_export/export.xml`.

It imports the last 12 months of workouts (run, walk, hike, row, strength, yoga and others, with distance, heart rate and active energy), weigh-ins, resting heart rate and VO2 max. Re-importing later adds only what is new. Small zips can be picked directly; large ones should be unzipped first.

## Keeping data safe

The data exists only on the phone. Deleting the Home Screen icon deletes it. Back up from Settings > Back up now > Save to Files, into iCloud Drive or Google Drive.

## Updating the app

Change the files, bump `VERSION` in `sw.js`, and re-upload. The installed app shows "A new version is ready" the next time it is online; tap Reload.

## Evidence behind the defaults

- Maximum heart rate 208 − 0.7 × age: Tanaka, Monahan and Seals, J Am Coll Cardiol 2001.
- Zone 2 at 60 to 70% of max heart rate: a common coaching convention, not a single agreed standard.
- 4x4 intervals, 4 minutes at 85 to 95% of max heart rate with 3 minutes easy: Helgerud and colleagues 2007.
- Older-adult activity guideline, 150 minutes moderate aerobic plus 2 strength days plus balance: HHS Physical Activity Guidelines, 2nd edition, 2018.
- Protein at least 1.2 g/kg for active adults over 65: PROT-AGE Study Group (Bauer and colleagues 2013). Waypoint defaults higher (1.6) during a calorie deficit; adjustable from 1.2 to 2.0.
- Slower weight loss preserves lean mass: Garthe and colleagues 2011.
- Adaptive expenditure: modeled on MacroFactor's published description; uses 3,500 kcal per pound, which is an approximation (Thomas and colleagues 2013).
- Single-run spikes over 10% of the longest run in the past 30 days: Frandsen and colleagues, British Journal of Sports Medicine 2025 (5,205 runners).
- McGill Big 3, descending pyramid of about 10-second holds: Stuart McGill, Low Back Disorders.

## Limits compared with a native app

- No direct Apple Health or Apple Watch sync; import by export file.
- No push reminders (web push needs a server). An iOS Shortcuts personal automation (Time of Day > Open App) can open Waypoint each morning for the check-in.
- iOS may pause timers when the screen locks; the timers request a screen wake lock, so keep the screen on during guided sessions.
- Fitness education, not medical advice.

## Files

| File | Contents |
|---|---|
| `index.html` | Layout, styles, icons |
| `figure.js` | Stick-figure animation engine |
| `data.js` | Exercise library, progression chains, templates, tests, guides |
| `engine.js` | Heart-rate zones, weight trend, energy estimate, readiness, session building, progression |
| `app.js` | Storage, Today, check-in, timers |
| `app2.js` | Session player, cardio, Train |
| `app3.js` | Food, Progress, Learn, Settings, Apple Health import, backup |
| `sw.js` | Offline cache |
