# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CougSpot is a student hub for Norco High School (Norco Cougars). It is a **static site with no build step** — plain HTML, CSS, and vanilla JavaScript backed by Supabase. There are no npm packages, no bundler, and no framework.

## Development

**Run locally:** Open `index.html` in a browser, or serve with any static HTTP server:
```bash
python3 -m http.server 8080
# or
npx serve .
```

There are no lint, test, or build commands. All changes are verified manually in the browser.

## Architecture

The entire app is five files:

| File | Purpose |
|---|---|
| `index.html` | Main SPA: landing/auth modals, home feed, period clock, announcements |
| `app.js` | All core logic: auth, posts, comments, realtime subscriptions, moderation |
| `sports.html` | Separate sports schedules page |
| `sports.js` | Fetches MaxPreps data via Supabase Edge Function proxy, renders game cards |
| `styles.css` | Shared design system for both pages |

### Backend: Supabase (project `dqcyecscdelfikbimnpw`)

The Supabase client is initialized in both `app.js` and `sports.js` using hardcoded `SUPABASE_URL` and `SUPABASE_ANON` constants. All DB access uses the Supabase JS SDK loaded via CDN.

**Tables:** `posts`, `comments`, `announcements`, `flags`, `spam_log`

**Realtime channels** (Postgres subscriptions):
- `announcements-rt` — all events on announcements table
- `posts-rt` — INSERT events on posts table (new posts prepend to feed)
- `comments-rt` — comment updates

**Edge Function:** `sports-proxy` — proxies MaxPreps schedule data for Norco Cougars. Sports data is cached in `sessionStorage` with a 1-hour TTL per sport.

### Auth

Users sign up with a username; email is synthesized as `{username}@cougspot.app`. Account creation requires `SITE_PIN = '2345'`. Admin features (announcement tools) require `ADMIN_PIN = '7892'`.

### SPA Navigation

`index.html` manages multiple `<div id="screen-*">` elements shown/hidden by toggling CSS. The flow is: `screen-loading` → `screen-landing` → `screen-home`.

### Content Moderation (client-side, `app.js`)

- **Sexual content** (`SEXUAL_PATTERNS`): hard-blocks submission
- **Threats** (`THREAT_PATTERNS`): silently inserts a row into `flags` table but does not block
- **Spam** (`SPAM_PATTERNS`): checked on post/comment submit; rate limit is 5 posts/minute (enforced via `postTimestamps` array + `spam_log` table)

### Bell Schedule / Period Clock

`getTodaySchedule()` returns `SCHEDULE_STANDARD` (Mon/Tue/Thu/Fri) or `SCHEDULE_WEDNESDAY` (PLC late start), or `null` on weekends. The clock ticks every second via `setInterval`.

## Key Patterns

- All user content is HTML-escaped via `escHtml()` before DOM insertion.
- `toast(msg, type)` shows transient notifications (types: `'success'`, `'error'`, default).
- `timeAgo(dateString)` renders relative timestamps.
- Posts have an `is_anon` flag stored in the DB; anonymous display is handled at render time.
- Comments support one level of nesting via `parent_id` (flat in DB, rendered as nested HTML).
- The `source` field on posts distinguishes user posts from `'social'` posts (admin-seeded content shown with a violet badge).

## Design Tokens

Defined as CSS custom properties on `:root` in `styles.css`. Key colors:
- `--void: #080a10` (page background)
- `--surface: #0d1120`, `--raised: #111828` (card/input backgrounds)
- `--blue: #1a3adb`, `--violet: #7b5ef8`, `--electric: #2e6fff`
- `--text: #e8eaf2`, `--muted: #6b7a9e`

Fonts: **Syne** (headings), **DM Sans** (body) — loaded from Google Fonts in both HTML files.
