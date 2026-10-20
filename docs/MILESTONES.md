# Milestones

Tracker for building the roadmap in [`PRD.md`](PRD.md) (section 1.8). The
`milestone-builder` agent (`.claude/agents/milestone-builder.md`) works on the
first milestone whose status is not **Done**, checks off items as they land,
and marks the milestone **Done** when its definition of done is met.

Status values: `Not started` · `In progress` · `Done`

---

## Milestone 1: MVP, single-platform viral search

**Status:** Done (2026-10-20)

- [x] FR-1 to FR-16 from PRD §1.7 (keyword search on TikTok / Shorts / YouTube, date ranges, viral score, sorting, filters, Load more, shareable URLs)
- [x] Review fixes listed in the PRD's "Review follow-up" table (rate limit, strict range check, URL allowlist, timeout, CDN cache, YouTube 3-month trim, contrast, tab stops)

---

## Milestone 2: v1.1, trust, measurement, cost

**Status:** Done (2026-10-20)

Sources: PRD §1.8 (v1.1 row), §2.7 (UX P0 and P1), §5 launch checklist, §3 testing.

### Cost and abuse controls
- [x] Daily credit cap: count upstream calls per UTC day in Netlify Blobs; above `DAILY_CREDIT_CAP` (env, default 500) return 503 with code `daily_limit` (PRD §5)
- [x] Kill switch: env `SEARCH_DISABLED=true` returns 503 with code `disabled` without calling upstream (PRD §5)
- [x] Low-credit alert: log a warning when `credits_remaining` drops below `CREDITS_ALERT_THRESHOLD` (env, default 1000); never send the balance to the browser (PRD §1.8 P2)
- [x] Normalize cache key: trim and lowercase `q`, and send `Netlify-Vary: query=q|platform|range|cursor` (PRD §5)

### Errors and states
- [x] Function returns a typed `code` with every error (`bad_request`, `rate_limited`, `out_of_credits`, `daily_limit`, `disabled`, `upstream_error`, `timeout`, `config`) and does not echo raw upstream text to users (PRD §2.7 P0-2, §5)
- [x] Friendly out-of-credits / daily-limit state in the UI (PRD §2.7 P0-2)
- [x] Error panel with a Retry button (PRD §2.7 P0-4)
- [x] Shared `?q=` links fill the form but wait for the user to press Search, so links cannot auto-spend credits (PRD §5)

### Accessibility and UX
- [x] Accessible score label on each card ("Viral score 72 of 100") (PRD §2.7 P0-3)
- [x] Keep focus across re-sort and Load more; announce how many videos were added (PRD §2.7 P0-5)
- [x] `sort` and `minViews` saved in the URL, plus a "Copy link" button with a "Link copied" announcement (PRD §1.8 P1, §2.7 P1-1)
- [x] Changing Platform or Posted re-runs the current search (PRD §2.7 P1-2)
- [x] Score explainer: an info button showing how the score is calculated, and a per-card breakdown tooltip (PRD §1.8 P1, §2.7 P1-5)
- [x] "End of results" message when there is no next page (PRD §2.7 P1-6)

### Features
- [x] "All platforms" mode: query TikTok, Shorts and YouTube together and merge them into one ranked list (counts as 3 credits; say so in the UI) (PRD §1.8 P1)

### Measurement
- [x] Privacy-friendly analytics: `POST /api/event` function that logs structured events (no cookies, no IP or user agent stored, no query text beyond a length bucket) for the KPIs in PRD §1.6, e.g. `search`, `results_shown`, `load_more`, `video_open`, `copy_link`, `error` (PRD §1.8 P0, §4.6)

### Quality
- [x] Automated tests with `node --test` (no network): function validation, normalization, error codes, caps, kill switch; score and formatting helpers. `npm test` runs them.
- [x] README and `.env.example` updated with the new env vars
- [x] Privacy Notice page linked in the footer (PRD §5)

**Definition of done:** every box above is checked, `npm test` passes, the UI is verified in a headless browser with a mocked `/api/search` at 1200px and 375px wide with no console errors, and the PRD's status notes are updated.

---

## Milestone 3a: v2 part 1, export and better scoring

**Status:** Done (2026-10-20)

### Export
- [x] "Export CSV" button: downloads the currently shown results (after sort and min-views filter) with columns platform, title, author, handle, url, views, likes, comments, shares, views_per_hour, engagement_rate, viral_score, published_at, duration_sec. Escape CSV correctly and neutralize spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@`) (PRD §1.8 P1, §5)
- [x] "Copy" action: copies the shown results as plain text (rank, title, URL, key stats), with a "Copied" announcement in the live region (PRD §1.8 P1)
- [x] Both are client-side only and spend no credits; both are disabled when there are no results

### Improved viral score (PRD §4.4, v1.1a variant: free, no extra API calls)
- [x] Age-adjusted velocity, smoothed engagement and per-platform percentile normalization against the current result set, exactly as specified in PRD §4.4; fall back to the current formula when a platform has fewer than 20 results
- [x] Unknown publish date no longer adds points (the 720-hour assumption is removed or made neutral), and very small videos can't outscore big ones on engagement alone (PRD §4.3 findings)
- [x] YouTube results without likes aren't penalized relative to TikTok (PRD §4.3)
- [x] The score explainer and per-card breakdown from Milestone 2 describe the new model
- [x] Unit tests reproduce the PRD §4.3 worked examples and show the new model fixes each listed bias

**Definition of done:** every box above is checked, `npm test` passes, the UI is verified in a headless browser at 1200px and 375px wide with no console errors, a downloaded CSV opens with correct columns and escaping, and the PRD's status notes are updated.

---

## Milestone 3b: v2 part 2, accounts and retention

**Status:** Not started. Needs decisions before work begins (see below).

- [ ] Accounts with saved searches and history (PRD §1.8 P0)
- [ ] Trend alerts: email when a saved keyword gets a video above a score threshold (P1)
- [ ] Track a video's views over time to measure real growth speed (P1)
- [ ] Server-maintained per-platform score quantiles (PRD §4.4 v1.1b) (P2)
- [ ] More platforms, such as Instagram Reels (P2)
- [ ] Paid tier with quotas, if the cost per active user justifies it (P2)

**Decisions needed from the owner before starting:** auth provider (e.g. Netlify Identity or Supabase), database, email provider for alerts, and the primary persona (PRD §1.10, question 8).
