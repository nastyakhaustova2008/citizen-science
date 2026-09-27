# מִצְפֶּה (Mitzpe) — school citizen-science network

A web app for a school measurement network. Students take simple measurements (yard temperature,
humidity, sky brightness, PM2.5, water quality…) with one shared protocol per lab and put them on a
common map. Teachers (admins) create and review the labs, moderate comments and photos.

Most users are minors, so privacy decides a lot of the design: logged-out visitors see
measurements but never who made them, coordinates are rounded to ~100 m, photos are private and
approved by a teacher, and the privacy policy (`public/privacy.html`, he / en / ru) must always
match the code.

Interface language is **Hebrew (RTL)** by default; English and Russian are included. Every
user-facing string lives in [`src/i18n/strings.js`](src/i18n/strings.js).

## Stack

- React 18 + Vite 5, JavaScript (JSX), React Router (HashRouter), Tailwind CSS
- **Supabase**: PostgreSQL with row-level security (all rules are enforced in the database),
  Auth (username + password through the Edge Function `account`, or Google), Storage (private
  buckets for photos and profile pictures), pg_cron cleanups
- Leaflet + OpenStreetMap tiles, Recharts, lucide-react
- Hosting: Vercel (security headers in `vercel.json`)

## Run locally

Node.js 18+.

```bash
npm install
# .env.local (not committed): VITE_SUPABASE_URL=…  VITE_SUPABASE_ANON_KEY=… (the publishable key)
npm run dev          # http://localhost:5173
npm run build        # → dist/
```

Without the two variables the app starts but shows error states instead of data.

Database tests (a throwaway local PostgreSQL 16, never the real project):

```bash
supabase/tests/run.sh      # see supabase/tests/README.md
```

## Where things are

| | |
| --- | --- |
| `src/` | the app (pages, components, `lib/` API calls and rules, `context/` data and auth) |
| `supabase/migrations/` | the database schema, run by hand in the Supabase SQL Editor, in number order |
| `supabase/rollback/`, `supabase/checks/` | emergency rollbacks and read-only check queries |
| `supabase/functions/account/` | the Edge Function (sign-up, username log-in, password / email change, account deletion, file cleanup) |
| `supabase/SETUP_AUTH.md` | every manual step in Supabase / Google Cloud / Vercel, in order, plus monthly checks and backups |
| `CLAUDE.md` | detailed notes for developers (in Russian): rules, access, deploy order of each migration |
| `NEXT_GOALS.md` | what is done and what comes next |

## Screens

| Route | Screen |
| --- | --- |
| `/` | Home — counters, labs with filters and search, newest measurements |
| `/observations/:slug` | A lab — map, data table (paged, export), charts |
| `/observations/:slug/add` | Add a measurement (logged in): place → values → photo |
| `/protocol/:slug` | The lab's protocol (printable) |
| `/profile`, `/profile/:id` | Profile (logged in only); admins: administration panel |
| `/labs/new`, `/labs/:id/edit`, `/labs/:id/review` | Lab editor and review (admins) |
| `/login`, `/signup`, … | Accounts |

Demo parts that are not real yet (the forum, "join a lab") are hidden by flags in
`src/lib/features.js`.

## Accessibility

Keyboard-operable tabs, visible focus rings, skip link, `aria-live` for results and errors, alt
text, AA-contrast palette, tap targets ≥ 24 px (44 px on touch screens), `prefers-reduced-motion`
respected, correct right-to-left layout.
