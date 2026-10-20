<div align="center">
  <img src="docs/logo.png" alt="DevTime Logo" width="120" />

  # DevTime

  **Self-hosted coding time tracking for your editors: projects, languages, goals and weekly reports, with Authentik single sign-on. A rewrite of wakapi, compatible with the WakaTime editor plugins.**

  [![Status](https://img.shields.io/badge/status-work%20in%20progress-orange)](#--disclaimer)
  [![License](https://img.shields.io/badge/license-AGPL%203.0-blue)](LICENSE)
  [![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
  [![Node.js](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1)](https://www.postgresql.org)
  [![Web](https://img.shields.io/badge/web-dev.bayfield.dev-brightgreen)](https://dev.bayfield.dev)

  <br />
  <br />

  <img src="docs/screenshots/dashboard-light.png" alt="The dashboard in the light theme" width="900" />
</div>


## ⚠️ • Disclaimer

This is a personal project built for my own use, not a polished product: expect missing pieces, sharp edges, and breaking changes.


## 📋 • Table of Contents

- [📖 • Overview](#--overview)
- [🧩 • Components](#--components)
- [🛠️ • Tech Stack](#️--tech-stack)
- [🚀 • Getting Started](#--getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [🔌 • Connecting Your Editors](#--connecting-your-editors)
- [🚚 • Migrating From wakapi](#--migrating-from-wakapi)
- [🔐 • Sign-in & Security](#--sign-in--security)
- [⌨️ • Keyboard Shortcuts](#️--keyboard-shortcuts)
- [⏱️ • How Time Is Counted](#️--how-time-is-counted)
- [🌍 • Sharing & Badges](#--sharing--badges)
- [❤️ • Health Check](#️--health-check)
- [📁 • Project Structure](#--project-structure)
- [🐳 • Docker Deployment](#--docker-deployment)
- [🙌 • Credits](#--credits)
- [📄 • License](#--license)


## 📖 • Overview

DevTime receives heartbeats from your editors (through the official WakaTime plugins and `wakatime-cli`) and turns them into coding time per project, language, editor, OS, machine, branch and category. It replaces my [wakapi](https://github.com/muety/wakapi) instance: same ingest API and the same way of counting time, with a UI built like my other apps ([Calendar](https://github.com/PaulBayfield/calendar.bayfield.dev), [Notes](https://github.com/PaulBayfield/notes.bayfield.dev)) and the things wakapi was missing for me.

Key features:
- **Dashboard:** total vs the previous period, daily average, active days, best day, a stacked time chart (per day, week or month), breakdowns for every dimension, a yearly activity calendar and a weekday × hour heatmap. Click anything to filter; ranges and filters live in the URL
- **Projects:** every project with its last activity and totals; per-project pages with branches, languages and most-worked-on files; rename or merge projects (future heartbeats follow through an alias)
- **Goals:** daily or weekly targets for all coding or one project, language, editor or category, with streaks and history
- **Weekly report** by email (English or French)
- **Public page, a WakaTime-compatible API, README badges and a languages card**, all off until you turn them on, under a public name you choose, and limited to what you choose to share
- **Sign in with Authentik** (OIDC) only: no DevTime passwords; MFA is Authentik's job. See and sign out your devices
- **Themes:** System, Light, Dark, Rosé Pine, Rosé Pine Dawn. UI in English or French
- Export everything as CSV or JSON


## 🧩 • Components

```mermaid
flowchart TD
    You(("You"))
    Editors["Editors<br/>WakaTime plugins + wakatime-cli"]
    Web["Web app (Vite + React)"]
    Server["Server (Node + Hono)<br/>static host · app API · heartbeat API"]
    DB[("PostgreSQL<br/>heartbeats · daily stats · users")]
    Auth[("Authentik<br/>OIDC")]
    Mail[("SMTP<br/>weekly reports")]

    Editors -- "heartbeats (API key)" --> Server
    You -- "uses" --> Web
    Web -- "served by, calls" --> Server
    Server -- "stores" --> DB
    Server -- "sign-in" --> Auth
    Server -- "sends" --> Mail
```

| Component | Description |
|---|---|
| [`src`](src) | The React app: dashboard, projects, goals, settings, public profile. |
| [`server`](server) | A Hono server on Node: the WakaTime-compatible heartbeat API, the app's API, sign-in, weekly emails, badges, and the web build. Also the wakapi importer and an account CLI. |


## 🛠️ • Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [React 19](https://react.dev), TypeScript, [Vite](https://vite.dev), hand-drawn SVG charts |
| Server | Node.js ≥ 24 (runs TypeScript directly), [Hono](https://hono.dev) |
| Database | PostgreSQL via [postgres.js](https://github.com/porsager/postgres); [embedded-postgres](https://github.com/leinelissen/embedded-postgres) for local development |
| Auth | OIDC (authorization code + PKCE) with Authentik |
| Email | [Nodemailer](https://nodemailer.com) |
| Containerization | Docker Compose, images on `ghcr.io` |


## 🚀 • Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 24 and npm
- *(Deployment)* Docker & Docker Compose, and a reverse proxy
- *(Optional)* An [Authentik](https://goauthentik.io) instance (or any OIDC provider), and an SMTP account for weekly reports

### Installation

```sh
# 1. Clone the repository
git clone https://github.com/PaulBayfield/dev.bayfield.dev.git
cd dev.bayfield.dev

# 2. Install the app's and the server's dependencies
npm install && npm --prefix server install

# 3. Copy the server's env file, then fill it in
cp server/.env.example server/.env
```

### Environment Variables

[`server/.env.example`](server/.env.example) → `server/.env`, read by the server (locally or in Docker):

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | **Yes** | Where DevTime is reachable (OIDC redirect, badge and profile links, emails) |
| `DATABASE_URL` | **Yes** | PostgreSQL connection URL (Docker Compose sets it) |
| `DATABASE_POOL_MAX` | No (default `10`) | Database connections |
| `PORT` | No (default `8790`) | Port to listen on |
| `OIDC_ISSUER` | **Yes** | Authentik's issuer URL, e.g. `https://auth.example.com/application/o/devtime/` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | **Yes** | The provider's client credentials |
| `OIDC_NAME` | No (default `Authentik`) | Shown on the sign-in button |
| `OIDC_AUTO_CREATE` | No (default `true`) | Create an account on first SSO sign-in; `false` only lets in users an admin created |
| `OIDC_ALLOWED_GROUPS` | No | Comma-separated groups (`groups` claim) allowed in |
| `OIDC_ADMIN_GROUPS` | No | Members of these groups are admins |
| `DEV_LOGIN_USER` | No | Local development only: a "Development sign-in" button that signs in as this user without Authentik. Ignored unless `PUBLIC_URL` is `http://localhost` |
| `SESSION_IDLE_DAYS` | No (default `30`) | Idle days before a session expires |
| `SMTP_URL` / `MAIL_FROM` | No | Weekly reports, e.g. `smtps://user:pass@smtp.example.com:465` |
| `CLIENT_IP_HEADER` | No | Header with the visitor IP from your proxy, for rate limiting (e.g. `cf-connecting-ip`) |
| `HEARTBEAT_MAX_AGE_DAYS` | No (default `365`) | Older heartbeats are rejected |
| `UPDATE_CHECK` | No (default `true`) | Look on GitHub for a newer release, shown in **Settings → About**. `false` stops the outbound request |

[`.env.example`](.env.example) → `.env` holds `POSTGRES_PASSWORD` for Docker Compose.

### Running Locally

```sh
npm --prefix server run db:dev   # a local Postgres on :5433 (embedded-postgres), data in server/data
npm --prefix server run seed     # optional: a "demo" user with a year of fake data
npm run server                   # API on :8790, needs server/.env
npm run dev                      # web UI on http://localhost:1430 (proxies /api to :8790)
```

Set `OIDC_*` to sign in with Authentik (add `http://localhost:8790/api/auth/oidc/callback` as a redirect URI), or `DEV_LOGIN_USER=demo` for a local-only development sign-in. The first account ever created is the admin.


## 🔌 • Connecting Your Editors

1. Install the [WakaTime plugin](https://wakatime.com/plugins) for your editor.
2. Create an API key in **Settings → Editors & API keys**, then put this in `~/.wakatime.cfg` (on Windows, `%USERPROFILE%\.wakatime.cfg`):

   ```ini
   [settings]
   api_url = https://dev.bayfield.dev/api
   api_key = <your key>
   ```

3. Code for a minute: the time shows up on the dashboard, and your editor's status bar shows today's total.

The heartbeat paths match wakapi's (`/api/users/current/heartbeats.bulk`, `/api/heartbeat`, `/api/compat/wakatime/v1/…`), as does the status bar endpoint (`/api/users/current/statusbar/today`). Keys are accepted as `Basic base64(key)`, `Bearer` or `?api_key=`. DevTime doesn't relay to or import from wakatime.com.


## 🚚 • Migrating From wakapi

The importer reads a wakapi **PostgreSQL** database directly:

```sh
# Locally:
npm --prefix server run migrate:wakapi -- "postgres://user:pass@host:5432/wakapi"
# In Docker (the wakapi database must be reachable from the container):
docker compose exec devtime npm run migrate:wakapi -- "postgres://user:pass@wakapi-db:5432/wakapi"
```

| Option | Description |
|---|---|
| `--tz Europe/Paris` | Wakapi stores times without a zone, as the wall-clock time of the wakapi server. That's UTC in its Docker image (the default); pass the zone if you set `TZ` on it |
| `--users paul,alice` | Only these users |
| `--dry-run` | Read everything, write nothing |

What comes over: users (time zone, week start, timeout, sharing and weekly-report choices, wakapi's SSO subject), **API keys** (so editors keep working: only `api_url` changes), project and language aliases (applied to the names, and kept for future heartbeats), extension → language mappings, and every heartbeat. Durations are then recomputed with wakapi's exact rule, so your totals match. Running it again only adds what's missing.

Language, editor and OS names are normalized against GitHub Linguist's list, so wakapi's `Typescript` / `Vscode` become `TypeScript` / `VS Code` and merge with new data.

**Passwords aren't imported**: DevTime only signs in through Authentik. Each imported account is claimed by your first sign-in that matches it: wakapi's SSO subject, then a verified email, then the username.


## 🔐 • Sign-in & Security

- **Authentik only:** there are no DevTime passwords. Authorization code flow with PKCE, state and nonce; the server is a confidential client and checks the ID token's issuer, audience and nonce. Access and admin rights can follow Authentik groups (`OIDC_ALLOWED_GROUPS`, `OIDC_ADMIN_GROUPS`). Turn on MFA in Authentik.
- **Accounts:** created on first sign-in (unless `OIDC_AUTO_CREATE=false`). Accounts imported from wakapi or created by an admin are claimed by the first sign-in with the same SSO subject, verified email, or username.
- **Sessions:** random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed over HTTPS); only their hashes are stored. See and revoke devices in **Settings → Security**; admins can sign a user out everywhere.
- Cookie-authenticated writes must come from DevTime's own origin; a strict Content-Security-Policy; rate limits on sign-in and public endpoints.
- Account chores from the command line: `npm --prefix server run user -- list | create | make-admin | sign-out`.


## ⌨️ • Keyboard Shortcuts

The same keys as Calendar and Notes.

| Key | Action |
|---|---|
| `Ctrl+K` or `/` | Search projects, languages, pages, settings |
| `T` | Today |
| `J` / `→` · `K` / `←` | Next / previous period |
| `W` · `M` · `Y` · `A` | This week · month · year · all time |
| `7` · `3` · `1` | Last 7 days · 30 days · 12 months |
| `Ctrl+B` (or `\`) · `.` | Toggle sidebar · filters panel |
| `Ctrl+,` | Settings |
| `Esc` | Close / cancel |


## ⏱️ • How Time Is Counted

Exactly like wakapi: each heartbeat counts the gap to your next heartbeat when that gap is shorter than your **timeout** (10 minutes by default, Settings → Data) and both fall on the same day in your time zone. Heartbeats AI agents send on their own (`type = app`, `category = ai coding`) don't count.

That gap is stored on each heartbeat and rolled up per day (`daily_stats`), so a year-long dashboard reads a few thousand rows instead of millions of heartbeats. Changing your time zone or timeout recomputes everything in the background.


## 🌍 • Sharing & Badges

Off by default. In **Settings → Sharing**:

- **Public identity**: a public username for your links and a public name to show. Your single sign-on username and real name never appear publicly, and once you pick a public username your account name stops working in public URLs.
- **Where**: the **public page** (`/u/<public username>`) and the **public API and badges** are switched on separately, so you can share the API without a page, or the reverse.
- **What**: a window (7–365 days, or all time) and what to show (languages, editors, project names, OS, machines, activity calendar).

Badges and the languages card come with the public API:

```md
![coding time](https://dev.bayfield.dev/api/badge/<username>.svg)
![devtime](https://dev.bayfield.dev/api/badge/<username>.svg?project=devtime)
![languages](https://dev.bayfield.dev/api/card/<username>.svg?theme=dark)
```

Badges take `range` (`last_7_days`, `last_30_days`, `all_time`, …, never further back than the shared window; by default the whole window), `label` and `color`. With the window on **All time**, the plain badge shows your total coding time.

### WakaTime-Compatible API

Under `/api`, `/api/v1` and `/api/compat/wakatime/v1`, so wakapi and WakaTime clients only need a new base URL:

| Route | Returns |
|---|---|
| `GET /users/:user` | The user: name, last heartbeat, last project and editor |
| `GET /users/:user/summaries?start=YYYY-MM-DD&end=YYYY-MM-DD` | One entry per day (end included) with totals and breakdowns; or `?range=last_7_days` |
| `GET /users/:user/stats/:range` | Totals and breakdowns over `last_7_days` (default), `last_30_days`, `last_6_months`, `last_year`, `all_time`, … |
| `GET /users/:user/statusbar/today` | What editors show in their status bar (key only) |

- **With your API key** (`Authorization: Basic base64(key)` or `Bearer <key>`, `:user` = `current`, your username or public username): everything.
- **Without a key** (`:user` = public username): only with the public API on, and only what you share. Hidden breakdowns are left out, nothing older than the window, and `summaries` (day by day) needs the activity calendar to be shared.

The read routes send `Access-Control-Allow-Origin: *`, so a website can call them from the browser.


## ❤️ • Health Check

```sh
curl http://localhost:8790/api/health
```

```json
{ "ok": true }
```

It also checks the database connection. The Docker image uses it as its `HEALTHCHECK`.


## 📁 • Project Structure

```
dev.bayfield.dev/
├── .github/workflows/
│   ├── ci.yml                  # Type-checks and builds the web app and server
│   └── deployment.yaml         # Builds & publishes the Docker image to ghcr.io
├── src/                        # React app
│   ├── components/             # Dashboard, ProjectsPage, GoalsPage, charts, settings, ...
│   ├── lib/                    # API client, i18n, settings, router, colours
│   └── App.tsx
├── server/
│   ├── src/
│   │   ├── index.ts            # Routes, security headers, static hosting
│   │   ├── ingest.ts           # WakaTime-compatible heartbeat + status bar API
│   │   ├── durations.ts        # Heartbeat durations and the daily rollup
│   │   ├── stats.ts            # Dashboard queries
│   │   ├── auth.ts             # Sessions and Authentik (OIDC) sign-in
│   │   ├── api.ts              # The app's API
│   │   ├── public.ts           # Public page, badges, languages card
│   │   ├── compat.ts           # WakaTime-compatible read API (user, summaries, stats)
│   │   ├── reports.ts          # Weekly emails
│   │   ├── migrate-wakapi.ts   # wakapi importer
│   │   ├── cli.ts              # Account chores
│   │   └── db.ts               # Schema migrations
│   └── scripts/                # Dev database and demo data
├── Dockerfile
└── docker-compose.yml
```


## 🐳 • Docker Deployment

One container serves the web app and both APIs; PostgreSQL runs next to it.

```sh
cp .env.example .env                  # POSTGRES_PASSWORD
cp server/.env.example server/.env    # PUBLIC_URL, OIDC_*, SMTP_URL…  (drop the local DATABASE_URL line)
docker compose up -d
```

Pushing to `main` builds and publishes the image to `ghcr.io/paulbayfield/dev.bayfield.dev` (tagged `latest` and the `package.json` version) via [`deployment.yaml`](.github/workflows/deployment.yaml). Put it behind your reverse proxy at `https://dev.bayfield.dev` → `localhost:8790`.


## 🙌 • Credits

| Person | Role |
|---|---|
| [Paul Bayfield](https://github.com/PaulBayfield) | Creator & maintainer |

DevTime also relies on:

| Project | Used for |
|---|---|
| [wakapi](https://github.com/muety/wakapi) (MIT) | The original: its heartbeat API, duration rule and user-agent parsing are followed here, and the importer reads its database |
| [WakaTime](https://wakatime.com) plugins & `wakatime-cli` | Sending heartbeats from editors |
| [GitHub Linguist](https://github.com/github-linguist/linguist) | Language names and colours (via wakapi's `colors.json`) |
| [Lucide](https://lucide.dev) | Icons |
| [Rosé Pine](https://rosepinetheme.com) | The Rosé Pine and Rosé Pine Dawn themes |


## 📄 • License

DevTime is licensed under the [AGPL 3.0](LICENSE).

```
DevTime
Copyright (C) 2026 Paul Bayfield

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
```
