# Momentum

A calm, editorial personal productivity workspace: tasks, projects, a calendar, and an optional AI assistant ("Momentum Intelligence"). Works offline in **Local Mode** (browser storage) or signed in with a **Cloud workspace** synced to Postgres.

Live: https://momentumtodo.vercel.app

## Features

- Tasks with priority, due date/time, tags, subtasks, notes, and recurrence (daily, weekdays, weekly, monthly)
- Views: Today, Inbox, Upcoming, Calendar, Completed, Overdue, per-project and per-tag
- Command palette (⌘K / Ctrl+K), keyboard shortcuts (`?`), undo, in-app reminders
- Passwordless email-code and Google sign-in (Clerk), with a one-click import of local data into the cloud
- Momentum Intelligence: natural-language task capture, Plan My Day, task breakdown, project planning, briefings, and weekly reviews (Gemini or OpenAI)
- Installable PWA with an offline app shell
- Warm dark/light themes, motion that respects `prefers-reduced-motion`, keyboard focus rings, 44px touch targets

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS, no build step (`public/`) |
| API | TypeScript serverless functions on Vercel (`api/`) |
| Database | Neon Postgres with Drizzle ORM (`server/schema.ts`, `migrations/`) |
| Auth | Clerk (`@clerk/backend` on the server, ClerkJS in the browser) |
| AI | Google Gemini or OpenAI via a provider adapter (`server/ai/`) |

## Project structure

```text
public/
  index.html           App + landing markup
  css/                 Stylesheets, loaded in cascade order by index.html
    tokens.css           Design tokens (colors, radii, motion, tap size)
    …                    One file per UI area (layout, tasks, drawer, calendar…)
    motion.css           Animation layer (loaded after everything else)
    a11y.css             Focus rings, touch targets, forced-colors
  js/                  Classic scripts sharing one global scope, loaded in order:
    data.js              Constants, escapeHtml, normalization, local/cloud stores
    icons.js             Inline SVG icon set
    motion.js            Motion engine (FLIP list reordering, counters, bursts)
    core.js              Undo, DOM refs, app state, toasts, theme, date helpers
    task-ui.js           Composer, task drawer, project modal, context menu
    account.js           Auth, onboarding, account/privacy, import
    views.js             Render loop, calendar, side rail
    actions.js           CRUD, command palette, shortcuts, reminders
    ambient.js           WebGL background
    ai.js                Momentum Intelligence client
    main.js              Boot (must load last)
  landing.css / landing.js   Marketing landing page
  sw.js                Service worker (network-first, offline fallback)
api/                   Vercel serverless routes (tasks, projects, settings, auth, ai, import, health)
server/                Shared server code: db, schema, validators, auth, AI providers
migrations/            Drizzle SQL migrations
tests/                 Unit tests (node:test via tsx)
```

> **Adding a script or stylesheet?** Add it to `index.html` in the right order **and** to `STATIC_SHELL_ASSETS` in `public/sw.js`, then bump `CACHE_NAME`.

## Getting started

Requires Node.js 22+.

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, Clerk keys, and (optionally) AI keys
npm run db:migrate
npm run dev            # http://localhost:8088
```

Without Clerk keys the app still runs: choose **Continue in Local Mode** on the landing page.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Local server for `public/` and `api/` on port 8088 |
| `npm test` | Unit tests (recurrence, validators, AI response validation, client/server parity) |
| `npm run check` | Typecheck + tests |
| `npm run build` | Typecheck (used by Vercel) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle schema tooling |
| `npm run test:health` | Calls the health handler against your database |

## Security notes

- Any user- or AI-provided value inserted with `innerHTML` **must** go through `escapeHtml()` (`public/js/data.js`). Prefer `textContent`.
- `/api/*` responses are never cached by the service worker or CDN.
- Secrets live only in environment variables; the Clerk publishable key is served from `/api/auth/config`.
