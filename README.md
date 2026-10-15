<div align="center">

<img src="logo.png" alt="ONESPORT logo" width="120" />

# ONESPORT

**Match rotation, live scoring and automatic standings for casual badminton and mini soccer sessions.**

[![Deploy to GitHub Pages](https://github.com/4eronn/One-Sport-Badminton/actions/workflows/deploy.yml/badge.svg)](https://github.com/4eronn/One-Sport-Badminton/actions/workflows/deploy.yml)
[![Build Android APK](https://github.com/4eronn/One-Sport-Badminton/actions/workflows/build-apk.yml/badge.svg)](https://github.com/4eronn/One-Sport-Badminton/actions/workflows/build-apk.yml)
[![Latest release](https://img.shields.io/github/v/release/4eronn/One-Sport-Badminton?label=release)](https://github.com/4eronn/One-Sport-Badminton/releases/latest)

[Live demo](https://one-sport-badminton.vercel.app/?room=MABAR+ONESPORT) · [Download APK](https://github.com/4eronn/One-Sport-Badminton/releases/latest) · [Report an issue](https://github.com/4eronn/One-Sport-Badminton/issues)

</div>

---

## Overview

ONESPORT is a lightweight web app for organizing informal group play sessions, the kind where a dozen or more people show up, share a few courts, and want everyone to get a fair number of games.

Add the players, set the number of courts, and the app builds the rotation, tracks scores as matches finish, and ranks everyone on a leaderboard. A session can also be broadcast live, so players and referees can follow along or enter scores from their own phones.

It runs entirely in the browser with no backend and no build step. It can be used as a website, installed as a PWA, or sideloaded as an Android app.

> The interface is currently in Indonesian.

## Features

### Badminton

- **Fair rotation.** Players who sat out longest (tracked via `waitingSince`) are scheduled first, followed by those with the fewest games played. Each player is guaranteed a configurable minimum number of matches (default: 3).
- **Skill levels.** Players are tagged as Pemula, Amatir, Intermediate or Advance, and teams are balanced accordingly.
- **Gender-aware pairing.** Women are grouped into women-only matches when >= 4 female players are waiting in queue. In mixed queues, awkward uneven pairings (3 men + 1 woman) are prevented whenever an alternative player is available in queue. Advance-level women can also be placed in open matches.
- **Flexible courts.** Add courts on the fly and change the number of planned rounds in settings.
- **Manual overrides.** Swap players in an upcoming match, edit a player's level mid-session, or use *Smart Match* to regenerate the upcoming rounds.
- **Resting list.** See at a glance who is sitting out in the current round.

### Mini soccer

- Team generator with player positions (GK, DF, MF, FW) and a configurable team count.
- Re-shuffle teams with one tap.
- Match results feed into the same leaderboard and history screens as badminton.

### Standings

Players are ranked by wins, with a tie-break sequence that is applied in order and stops as soon as a tie is resolved:

1. Head-to-head result (when exactly two players are tied)
2. Total points scored
3. Number of titles across sessions

The leaderboard can also be sorted by total score, score difference or win rate. When a session ends, the final podium can be shared directly to WhatsApp.

### Live sessions

- A host creates a room with a unique code (for example `BADM-782`) and a referee PIN.
- **Spectators** open the link or scan the QR code to follow courts and scores in real time.
- **Referees** can submit scores from their own device, so multiple courts can be scored at once.
- Open rooms are listed in a lobby, and finished broadcasts are saved to a local history.

### Data and platform

- Session data is saved to `localStorage` automatically and survives a refresh or a closed tab.
- Export and import full sessions as JSON; export the player roster as CSV.
- Installable as a PWA on Android and iOS, with offline caching through a service worker.
- Checks GitHub Releases for a newer version and prompts to update.

## Getting started

### Use it in the browser

Open the [live demo](https://one-sport-badminton.vercel.app/?room=MABAR+ONESPORT). No account or setup is required.

### Install as a PWA

- **Android (Chrome):** open the site, tap the ⋮ menu, then choose *Install app* or *Add to Home screen*.
- **iOS (Safari):** open the site, tap *Share*, then choose *Add to Home Screen*.

### Install the Android app

Download the latest `ONESPORT-v*.apk` from the [Releases](https://github.com/4eronn/One-Sport-Badminton/releases/latest) page and open it on your device. You will need to allow installation from unknown sources the first time.

### Run locally

There are no dependencies to install. Serve the project root with any static file server; the service worker requires `http://localhost` or HTTPS, so opening `index.html` directly from disk will not enable PWA features.

```bash
git clone https://github.com/4eronn/One-Sport-Badminton.git
cd One-Sport-Badminton

# any static server works
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Running a live session

1. Open the live panel (the **Live** tab or the banner on the court screen).
2. Choose **Host**, enter a room code and a PIN, and start the broadcast.
3. Share the room code or show the QR code.
4. Others join as a **spectator** (view only) or as a **referee** (view and score, using the PIN).

Live sync uses MQTT over secure WebSockets. See [Known limitations](#known-limitations) before relying on it for anything sensitive.

## Project structure

```
.
├── index.html              # The application (markup, styles and logic in one file)
├── minisoccer.html         # Standalone mini soccer view
├── badminton.html          # Redirects to index.html
├── badminton-bracket.html  # Redirects to index.html
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline caching)
├── logo*.png               # App icons and branding
├── android/                # Android WebView wrapper (Gradle project)
│   └── app/src/main/
│       ├── java/com/onesport/app/MainActivity.java
│       └── assets/         # Copy of the web files, synced by CI at build time
└── .github/workflows/
    ├── deploy.yml          # Publishes the site to GitHub Pages
    └── build-apk.yml       # Builds the APK and publishes a release
```

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | HTML, CSS and vanilla JavaScript (no framework, no bundler) |
| Realtime | [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.5.0 over WebSockets |
| QR codes | [qrcodejs](https://github.com/davidshimjs/qrcodejs) |
| Offline / install | Service Worker and Web App Manifest |
| Fonts | Outfit and Plus Jakarta Sans (Google Fonts) |
| Android | Native WebView wrapper, `minSdk 24`, `targetSdk 34`, Java 17 |
| CI/CD | GitHub Actions, GitHub Pages and GitHub Releases |

## Deployment

**Website.** The live demo is hosted on [Vercel](https://vercel.com). The project is a plain static site, so any static host works (Vercel, Netlify, Cloudflare Pages); no build command is needed and the output directory is the repository root.

The repository also includes an optional GitHub Pages workflow (`deploy.yml`) that publishes the root on every push to `main`. To use it, set *Settings → Pages → Source* to **GitHub Actions**; it will not publish anything until that is enabled.

**Android APK.** Every push to `main`, and every tag matching `v*`, runs `build-apk.yml`. The workflow copies the web files into `android/app/src/main/assets`, builds a release APK with JDK 17 and Gradle, and attaches it to a GitHub Release. The app version comes from `versionName` in `android/app/build.gradle`.

To build locally you need JDK 17 and the Android SDK:

```bash
cp index.html minisoccer.html badminton.html manifest.json sw.js logo*.png \
   android/app/src/main/assets/
cd android
./gradlew assembleRelease
```

## Known limitations

- **No backend.** All state lives in the browser. Clearing site data removes a session unless it was exported first.
- **Public MQTT brokers & Confidentiality.** Live sync relies on public brokers (EMQX, HiveMQ, and Mosquitto test server). While message integrity and role elevation are cryptographically secured (HMAC-SHA256 with PBKDF2 100k iterations, monotonic sequence numbers against replay, and nonce challenge-response PIN verification without transmitting plaintext or hashes), state data is not encrypted end-to-end. Anyone who subscribes to a room topic on a public broker can inspect match scores and player rosters.
- **Spectator Host Verification (Trust-on-First-Use).** Spectators verify the broadcast host's ephemeral ECDSA signature on a trust-on-first-use (TOFU) basis. Subsequent state updates must match the initial host key, but initial connection trusts the current broadcaster.
- **Android release signing.** Release APKs are currently signed with the debug keystore. They install fine, but they are not suitable for Play Store distribution as-is.

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so the approach can be discussed.

Because the app is a single static page, changes are easy to test: edit the files, serve the folder locally, and reload. If you change anything that the Android build bundles, remember that the CI workflow re-syncs `android/app/src/main/assets` on build.

## Author

Maintained by [@4eronn](https://github.com/4eronn).
