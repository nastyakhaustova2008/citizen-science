# מִצְפֶּה — School Citizen-Science Frontend

Frontend-only React app for a school measurement network. Students take simple
measurements (yard temperature, absolute humidity, sky brightness, PM2.5) on one
shared protocol and plot them on a common map. **All data is mocked — there is no backend.**

Interface language is **Hebrew (RTL)** by default; English and Russian are included
and switchable in the header. Every user-facing string lives in
[`src/i18n/strings.js`](src/i18n/strings.js).

## Stack

- React 18 + React Router (HashRouter)
- Tailwind CSS (custom muted "forest" palette, light + dark)
- Leaflet + OpenStreetMap tiles, `react-leaflet`, `react-leaflet-cluster`
- Recharts for the charts
- lucide-react for icons (thin line style)

## Run

Requires Node.js 18+ (not installed on the machine this was authored on).

```bash
npm install
npm run dev
```

Then open the printed local URL. Build with `npm run build`, preview with `npm run preview`.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Home — live counters, campaign grid with filters/search, activity feed |
| `/observations/:slug` | Campaign — tabs: Map · Data · Charts · Discussion |
| `/observations/:slug/add` | 3-step "add measurement" wizard (map pick / geolocation → values → photo) |
| `/observations/:slug` (Discussion tab) | Discourse-style forum, markdown, reactions, quoting, "ask an expert" |
| `/profile` / `/profile/:userId` | Participant profile — own points map, monthly contribution grid, badges |
| `/protocol/:slug` | Printable measurement protocol per campaign |

## Structure

```
src/
  i18n/            strings.js (he/en/ru) + provider with t() helper
  data/            mockData.js (seeded), metrics.js (scales, colour ramps)
  lib/             format, stats, export (CSV/JSON/GeoJSON), media (inline SVG placeholders)
  context/         ThemeContext, AppDataContext (in-session measurements/posts/joins)
  hooks/           useMockLoad (loading / error / empty state simulation)
  components/       primitives (skeleton/empty/error/badges), map/, data/, charts/, discussion/, wizard/
  pages/           HomePage, ObservationPage, AddMeasurementPage, ProfilePage, ProtocolPage, NotFoundPage
```

## Notes on the mock data

- 6 users (5 school participants across the country + 1 science mentor / verified expert)
- 12 measurement campaigns (4 metrics, "collecting" and "completed")
- ~36 measurement points, seeded so counts and values are stable between reloads
- 6 discussion topics with real threads, including expert-verified answers

## Design

Warm paper ground `#F7F4ED`, deep evergreen ink `#1F3A2E`, muted moss `#5A7A5F`,
bark/ochre accent `#8B6F47`. Serif headings (Frank Ruhl Libre), grotesque UI
(Assistant), monospace numbers (IBM Plex Mono). Thin borders instead of shadows,
8–12px radii, 150–200ms transitions on hover/transition only, a barely-there paper
grain. Dark theme swaps the ground to charcoal and keeps the greens.

## Accessibility

Keyboard-operable tabs (roving focus, RTL arrow handling), visible focus rings,
skip link, `aria-live` on result counts and validation, alt text on every image,
AA-contrast palette, `prefers-reduced-motion` respected.
