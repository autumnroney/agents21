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

**Status:** Not started

Sources: PRD §1.8 (v1.1 row), §2.7 (UX P0 and P1), §5 launch checklist, §3 testing.

### Cost and abuse controls
- [ ] Daily credit cap: count upstream calls per UTC day in Netlify Blobs; above `DAILY_CREDIT_CAP` (env, default 500) return 503 with code `daily_limit` (PRD §5)
- [ ] Kill switch: env `SEARCH_DISABLED=true` returns 503 with code `disabled` without calling upstream (PRD §5)
- [ ] Low-credit alert: log a warning when `credits_remaining` drops below `CREDITS_ALERT_THRESHOLD` (env, default 1000); never send the balance to the browser (PRD §1.8 P2)
- [ ] Normalize cache key: trim and lowercase `q`, and send `Netlify-Vary: query=q|platform|range|cursor` (PRD §5)

### Errors and states
- [ ] Function returns a typed `code` with every error (`bad_request`, `rate_limited`, `out_of_credits`, `daily_limit`, `disabled`, `upstream_error`, `timeout`, `config`) and does not echo raw upstream text to users (PRD §2.7 P0-2, §5)
- [ ] Friendly out-of-credits / daily-limit state in the UI (PRD §2.7 P0-2)
- [ ] Error panel with a Retry button (PRD §2.7 P0-4)
- [ ] Shared `?q=` links fill the form but wait for the user to press Search, so links cannot auto-spend credits (PRD §5)

### Accessibility and UX
- [ ] Accessible score label on each card ("Viral score 72 of 100") (PRD §2.7 P0-3)
- [ ] Keep focus across re-sort and Load more; announce how many videos were added (PRD §2.7 P0-5)
- [ ] `sort` and `minViews` saved in the URL, plus a "Copy link" button with a "Link copied" announcement (PRD §1.8 P1, §2.7 P1-1)
- [ ] Changing Platform or Posted re-runs the current search (PRD §2.7 P1-2)
- [ ] Score explainer: an info button showing how the score is calculated, and a per-card breakdown tooltip (PRD §1.8 P1, §2.7 P1-5)
- [ ] "End of results" message when there is no next page (PRD §2.7 P1-6)

### Features
- [ ] "All platforms" mode: query TikTok, Shorts and YouTube together and merge them into one ranked list (counts as 3 credits; say so in the UI) (PRD §1.8 P1)

### Measurement
- [ ] Privacy-friendly analytics: `POST /api/event` function that logs structured events (no cookies, no IP or user agent stored, no query text beyond a length bucket) for the KPIs in PRD §1.6, e.g. `search`, `results_shown`, `load_more`, `video_open`, `copy_link`, `error` (PRD §1.8 P0, §4.6)

### Quality
- [ ] Automated tests with `node --test` (no network): function validation, normalization, error codes, caps, kill switch; score and formatting helpers. `npm test` runs them.
- [ ] README and `.env.example` updated with the new env vars
- [ ] Privacy Notice page linked in the footer (PRD §5)

**Definition of done:** every box above is checked, `npm test` passes, the UI is verified in a headless browser with a mocked `/api/search` at 1200px and 375px wide with no console errors, and the PRD's status notes are updated.

---

## Milestone 3: v2, workflow and retention

**Status:** Not started. Needs decisions before work begins (see below).

- [ ] Accounts with saved searches and history (PRD §1.8 P0)
- [ ] CSV export and copy-to-clipboard of results (P1)
- [ ] Trend alerts: email when a saved keyword gets a video above a score threshold (P1)
- [ ] Track a video's views over time to measure real growth speed (P1)
- [ ] Improved v1.1 scoring model from PRD §4.4 (age-adjusted velocity, smoothed engagement, per-platform percentiles) (P2)
- [ ] More platforms, such as Instagram Reels (P2)
- [ ] Paid tier with quotas, if the cost per active user justifies it (P2)

**Decisions needed from the owner before starting:** auth provider (e.g. Netlify Identity or Supabase), database, email provider for alerts, and the primary persona (PRD §1.10, question 8).
