# Momentum

A calm, editorial task app for busy professionals: type tasks the way you'd say them, get reminded, and let an optional AI assistant plan your day. Try it without an account (tasks saved in this browser only) or sign in to keep tasks in your account (Postgres).

Live: https://momentumtodo.vercel.app

## Features

- Smart typing: "Call John tomorrow at 3pm, high priority #legal" fills in the date, time, priority, repeat and tags, with chips to undo any part (`public/js/smart-input.js`)
- Tasks with priority, due date/time, tags, subtasks, notes, and recurrence (daily, weekdays, weekly, monthly)
- Reminders as real system notifications (Mark done / Snooze 10 min) while the browser or installed app is running, plus an optional "Your day" morning email
- Friendly first run (3 example tasks), a self-ticking Getting started checklist, an install guide for phones, and a "save your tasks" nudge for people without an account
- Views: Today, Inbox, Upcoming, Calendar, Completed, Overdue, per-project and per-tag
- Command palette (⌘K / Ctrl+K), keyboard shortcuts (`?`), undo
- Passwordless email-code and Google sign-in (Clerk), with a one-click import of local data into the cloud
- AI assistant: natural-language task capture, Plan my day, task breakdown, project planning, briefings, and weekly reviews (Gemini or OpenAI)
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
    smart-input.js       Smart typing parser (pure, unit-tested) + composer chips
    motion.js            Motion engine (FLIP list reordering, counters, bursts)
    core.js              Undo, DOM refs, app state, toasts, theme, date helpers
    task-ui.js           Composer, task drawer, project modal, context menu
    account.js           Auth, onboarding, account/privacy, import
    views.js             Render loop, calendar, side rail
    actions.js           CRUD, command palette, shortcuts, reminder loop
    reminders.js         System notifications, "Turn on reminders" card, settings panel
    getting-started.js   First run (example tasks) + Getting started checklist
    phone.js             Phone search/filter sheet, install helper, save nudge
    ambient.js           WebGL background
    ai.js                AI assistant client
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

Without Clerk keys the app still runs: choose **Try without an account** on the landing page.

### "Your day" morning email (optional)

Hidden unless all three env vars are set: `CRON_SECRET`, `BREVO_API_KEY`, `DIGEST_FROM_EMAIL` (see `.env.example`).
Vercel Cron calls `/api/cron/daily-email` once a day (`vercel.json` → `crons`); unsubscribe links go to
`/api/email/unsubscribe`. Both are `?action=` branches of `api/settings/index.ts`. Needs migration `0004_daily_email`.
The free plan allows one cron run a day, so everyone gets the email from that run; per-person send hours are stored
for when a more frequent scheduler is available.

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
