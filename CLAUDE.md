@AGENTS.md

# World Cup 2026 — Live Dashboard

## What this project is
A Next.js 16 live dashboard for FIFA World Cup 2026. Pulls real data from **football-data.org** and auto-refreshes every 30s during live matches, 60s otherwise. Deployed on Netlify.

GitHub repo: https://github.com/Jummsie/worldcup-2026-dashboard

## Key files
- `app/page.tsx` — single `"use client"` page with all tabs and components
- `app/api/worldcup/route.ts` — server-side route handler; fetches standings, scorers, and matches from football-data.org. The API key NEVER reaches the browser.
- `app/globals.css` — full dark theme, all custom CSS (bracket, fixtures, scorers, my team, etc.)
- `app/layout.tsx` — Google Fonts (Oswald, Inter, JetBrains Mono) loaded via `<link>` tags; no Geist fonts
- `.env.local` — contains `FOOTBALL_DATA_API_KEY=...` (gitignored, never commit)

## API
- Provider: **football-data.org** free tier
- Competition code: `WC`, season: `2026`
- Rate limit: 10 requests/min → route handler uses `next: { revalidate: 55 }` for server-side caching
- Free tier returns a single flat standings table with no group breakdown — groups are reconstructed from match data using the `group` field on each match (see `tlaToGroup` map in route.ts)
- Endpoints used:
  - `/competitions/WC/standings?season=2026`
  - `/competitions/WC/scorers?season=2026&limit=20`
  - `/competitions/WC/matches?season=2026`

## Tabs (in order)
1. **Standings** — group tables A–L reconstructed from match data
2. **Fixtures & Results** — grouped by date; live matches pinned to top in green banner
3. **Goals / Team** — total goals scored per country (from finished/live matches)
4. **Bracket** — visual tournament bracket (R32 → R16 → QF → SF → Final) with connector lines
5. **Top Scorers** — player goal tally, cards, assists from API
6. **Assists** — players ranked by assists
7. **Goalkeepers** — players ranked by saves
8. **My Team** — user selects their country; shows group table (team highlighted), group fixtures, and knockout journey

## Architecture notes
- All API calls are server-side only (route handler). Client polls `/api/worldcup` via `fetch`.
- Polling: `POLL_LIVE = 30_000ms`, `POLL_IDLE = 60_000ms`. Switches based on whether any match has `IN_PLAY` or `PAUSED` status.
- Match times shown in viewer's local timezone via `toLocaleTimeString()`.
- Tailwind v4 — use `@import "tailwindcss"` (not `@tailwind base/components/utilities`).
- Google Fonts loaded via `<link>` in `<head>` in `layout.tsx`, not via `next/font`.

## Bracket structure
- Stages filtered from `allMatches`: `LAST_32`, `LAST_16`, `QUARTER_FINALS`, `SEMI_FINALS`, `FINAL`
- `MatchupCard` component renders a single matchup (home vs away, score, winner highlight)
- `BracketRound` component groups matches into pairs and renders with connector lines
- Connector lines: `.bracket-pair-item::after` (horizontal stub) + `.bracket-pair-vline` (vertical line between pair, `top: 25%; bottom: 25%`)
- All rounds use `justify-content: space-around; flex: 1` so matches align vertically across columns

## Deployment — Netlify
- Auto-deploys from `main` branch on GitHub push
- Set environment variable `FOOTBALL_DATA_API_KEY` in Netlify dashboard → Site settings → Environment variables
- Do NOT commit `.env.local`

## Git remote
SSH-based (token auth didn't work):
```
git remote set-url origin git@github.com:Jummsie/worldcup-2026-dashboard.git
```
