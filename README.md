<div align="center">

<img src="assets/brand/logo-round.svg" alt="" width="88" height="88">

# Health

**Recovery, strain and sleep from your Fitbit, scored on your Android phone.**

No server, no account, no cloud: Health reads your Fitbit data from Health Connect and keeps every byte on the phone.

[![CI](https://github.com/husainlab/Health-app/actions/workflows/ci.yml/badge.svg)](https://github.com/husainlab/Health-app/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/husainlab/Health-app?label=release)](https://github.com/husainlab/Health-app/releases/latest)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)

</div>

## Download

<div align="center">

<a href="https://github.com/husainlab/Health-app/raw/main/Health-release.apk"><img src="assets/badges/android.svg" alt="Download Health for Android" height="56"></a>

[**Direct APK Download (Health-release.apk)**](https://github.com/husainlab/Health-app/raw/main/Health-release.apk) · [View in Repository](https://github.com/husainlab/Health-app/blob/main/Health-release.apk) · [Releases](https://github.com/husainlab/Health-app/releases)

*Signed release APK built automatically on every update.*  
*Note: Make sure you are signed into your GitHub account in your browser when clicking the download links.*

</div>

## What you get

- **Sleep, Recovery and Strain** every morning, with a Strain Target for the day
- **Health Age**, **Stress** and **Energy Bank** through the day
- **Health Monitor**, **Journal**, **Trends**, **Reports** and **My Dashboard**

## How it works

```mermaid
flowchart LR
  F[Fitbit band] --> G[Google Health app]
  G --> HC[(Health Connect)]
  HC -->|read & write permissions| S[Sync on the phone]
  S --> DB[(SQLite: expo-sqlite, async)]
  DB --> P[Pipeline: stage 1, stage 2, scoring v19]
  P --> DB
  DB --> Q[View models]
  Q --> UI[Screens: Expo Router, Skia charts]
```

On first open, allow every Health Connect permission, including past data: Health imports the last 180 days and syncs data two-ways with Health Connect.

## Build from source

```sh
git clone https://github.com/husainlab/Health-app.git && cd Health-app
pnpm install && pnpm android
```

Expo SDK 57 with a development build (Health Connect is a native module, so not Expo Go). [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md) have the rest; releases are in [docs/releases.md](docs/releases.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

<sub>Health is an independent project, not affiliated with or endorsed by Fitbit, Google, WHOOP, Bevel, Garmin or any other
wearable maker. The code names other products only to cite what they publish.</sub>
