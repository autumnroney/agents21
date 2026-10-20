# Viral Finder: Product Requirements Document

| | |
|---|---|
| **Product** | Viral Finder: find viral TikTok, YouTube Shorts and YouTube videos by topic |
| **Status** | Draft v1.0 (MVP built; v1.1 built 2026-10-20; v2 part 1 built 2026-10-20) |
| **Date** | 2026-10-20 |
| **Owner** | Autumn Roney |
| **Authors** | Five expert agents (definitions in `.claude/agents/`) |

## Contents

1. [Product Overview & Requirements](#1-product-overview--requirements-product-manager): Product Manager
2. [User Experience & Design](#2-user-experience--design-uxui-designer): UX/UI Designer
3. [Technical Architecture](#3-technical-architecture-software-architect): Software Architect
4. [Data, Metrics & Virality Scoring](#4-data-metrics--virality-scoring-data-scientist): Data Scientist
5. [Security, Privacy & Compliance](#5-security-privacy--compliance-security--compliance-lead): Security & Compliance Lead

## Review follow-up: already fixed in the MVP

The agents reviewed the first build. These findings were fixed before this document was finalized; the sections below may still describe them as open.

| Finding | Raised by | Fix |
|---|---|---|
| `/api/search` had no rate limit (anyone could drain credits) | Security, Architect | Netlify rate limit: 20 requests/min per IP |
| `range=constructor` passed validation (`in` operator) | Security | Strict `Object.hasOwn` check |
| Upstream URLs used in `href` unchecked (`javascript:` risk) | Security | Only `http(s)` links/thumbnails pass through |
| Credit balance exposed to visitors | Security, UX | Removed from API response |
| Admin "missing API key" message shown to visitors | UX | Generic message to users; detail logged server-side |
| No upstream timeout | Architect | 20 s timeout |
| Cache was browser-only | Architect | Added Netlify CDN cache (5 min, durable) |
| YouTube "Last 3 months" returned a full year | PM, Architect, UX | Fetch "this year", then trim to the last 90 days |
| Button and score badge contrast ~2.2:1; light-mode error text ~3.1:1 | UX | Darker gradient (≥5.3:1); error text 6.4:1 |
| Two tab stops per card to the same link | UX | Thumbnail link removed from tab order |

### Shipped in v1.1 (Milestone 2, 2026-10-20)

| Item | Source | What shipped |
|---|---|---|
| Daily credit cap | §5.4 | Upstream calls counted per UTC day in Netlify Blobs; above `DAILY_CREDIT_CAP` (default 500) → 503 `daily_limit`. Fails open (logged) if Blobs is unavailable |
| Kill switch | §5.4 | `SEARCH_DISABLED=true` → 503 `disabled`, no upstream call |
| Low-credit alert | §1.8 P2, §3.9 | Warning log below `CREDITS_ALERT_THRESHOLD` (default 1000); balance never sent to the browser |
| Cache key | §3.7, §5.4 | `q` trimmed, whitespace collapsed and lowercased (client and server); `Netlify-Vary: query=q\|platform\|range\|cursor` |
| Typed errors | §2.7 P0-2, §3.4, §5 | Every error has `code` (`bad_request`, `rate_limited`, `out_of_credits`, `daily_limit`, `disabled`, `upstream_error`, `timeout`, `config`); fixed user messages, upstream text only in server logs; errors are `no-store`; upstream timeout now 8 s; cursor length/charset check |
| Error and limit states | §2.4, §2.7 P0-2, P0-4 | Error panel (`role="alert"`) with Retry; friendly daily-limit / paused notice that disables Search with an explanation; HTTP 429 from Netlify's rate limiter shown as `rate_limited` |
| Shared links | §5.1 gap 8, §5.7 | `?q=` fills the form; nothing is searched until the visitor presses Search |
| Accessibility | §2.6, §2.7 P0-3, P0-5 | Score is a button named "Viral score 72 of 100"; focus kept across re-sort; Load more announces "N more videos loaded" and focuses the first new card |
| Share and filters | §1.8 P1, §2.7 P1-1, P1-2, P1-6 | `sort` and `minViews` in the URL; Copy link with "Link copied" announcement; Platform/Posted changes re-run the search (debounced); "End of results" |
| Score explainer | §1.8 P1, §2.7 P1-5 | "i" button with the formula; per-card breakdown (speed points, engagement points, total) |
| All platforms | §1.8 P1 | `platform=all` queries TikTok, Shorts and YouTube in parallel, merges into one ranked list, pages with one combined cursor; UI says it uses 3 credits |
| Analytics | §1.8 P0, §4.6 | `POST /api/event` logs allowlisted events (`search`, `results_shown`, `load_more`, `video_open`, `copy_link`, `error`); no cookies, IP, user agent or query text (length bucket only); off under DNT/GPC |
| Tests | §3.11 | `npm test` (`node --test`, mocked fetch and Blobs): validation, normalization, error codes, cap, kill switch, events, score and formatting helpers |
| Privacy Notice | §5.5, §5.7 | `public/privacy.html`, linked in the footer (owner must add a contact email) |

### Shipped in v2 part 1 (Milestone 3a, 2026-10-20)

| Item | Source | What shipped |
|---|---|---|
| Export CSV | §1.8 v2 P1, §5 | "Export CSV" downloads the results on screen (after sort and min views) with columns `platform, title, author, handle, url, views, likes, comments, shares, views_per_hour, engagement_rate, viral_score, published_at, duration_sec`. RFC 4180 quoting (commas, quotes, line breaks), CRLF, UTF-8 BOM. Text cells starting with `=`, `+`, `-`, `@`, tab or CR (also after leading spaces) get a leading `'` so spreadsheets don't run them as formulas. Only `http(s)` URLs are exported |
| Copy results | §1.8 v2 P1 | "Copy results" copies the shown results as plain text (rank, title, URL, platform, handle, views, views/hr, engagement, score, age); "Copied N results" is announced in the live region |
| No credits | Milestone 3a | Both run in the browser only (no request) and are disabled when no results are shown. Analytics events `export_csv` / `copy_results` carry only a count |
| Viral score v1.1a | §4.3, §4.4 | Age-adjusted velocity, shrunk engagement, per-platform (and age-bucket) percentiles against the current result set, weighted renormalized combination and a confidence level; fixed-scale fallback below 20 results. See the implementation notes in §4.4 |
| Score explainer | §2.7 P1-5 | The "i" panel and the per-card breakdown describe the v1.1a model (percentile or fixed scale per part, missing parts, confidence) |
| Tests | §3.11, §4.3 | `tests/viral-score.test.mjs` reproduces the §4.3 worked examples with the v1 formula and checks each finding against v1.1a; `tests/export.test.mjs` covers CSV columns, escaping, formula neutralization and the plain-text copy |

Still open: server-maintained score quantiles (§4.4 v1.1b), the "Deep score" outlier component (§4.4 step 5), score validation against real growth (§4.5), skeleton loading, empty-state chips, CSP/security headers, origin checks, Terms of Use, and the rest of the v2 roadmap (Milestone 3b).

---

## 1. Product Overview & Requirements (Product Manager)

### 1.1 Overview

Viral Finder is a single-page web app that takes a topic or keyword and returns short-form and long-form videos from TikTok, YouTube Shorts and YouTube that are gaining views fastest. It ranks them with a 0-100 **viral score**. Under the hood, a static frontend (`public/`) calls one Netlify Function (`netlify/functions/search.mjs`, served at `/api/search`). That function sends the search to the ScrapeCreators API and keeps the `SCRAPECREATORS_API_KEY` on the server. It turns each platform's response into one common video shape (views, likes, comments, shares, publish time, duration, thumbnail, author). The browser then works out views/hour, engagement rate and the viral score, and handles sorting and filtering.

### 1.2 Problem statement

Creators, social media managers and marketers need to know **what is taking off right now** on a topic, so they can borrow formats, hooks and angles while the trend is still rising. Native platform search has three problems for this job:

- It is ranked by relevance or by total popularity, which favors old, already-saturated videos over ones that are speeding up now.
- It shows no growth speed (views/hour) or engagement rate, so users work out "is this actually viral?" in their heads.
- It covers one platform per app, with no consistent way to compare results.

Viral Finder replaces 15-30 minutes of manual scrolling with one search that sorts results by growth speed.

### 1.3 Target users and personas

| Persona | Description | Primary need | Frequency |
|---|---|---|---|
| **Solo Creator ("Maya")** | Posts 3-7 short videos/week in a niche (fitness, food, tech) | Find formats and hooks that are working this week in her niche | Several times/week |
| **Social Media Manager ("Dev")** | Runs brand accounts at an agency or SMB | Trend research for content calendars and client reports; share findings | Daily to weekly |
| **Growth Marketer / UGC buyer ("Priya")** | Sources creators and ad angles | Find fast-rising videos and their creators to spot partnership or ad-creative ideas | Weekly |
| **Curious browser** (secondary) | Non-professional | "What's viral about X?" | Occasional |

### 1.4 Jobs to be done and user stories

**Core JTBD:** *When I'm planning content on a topic, I want to see which recent videos are growing fastest, so I can model what's working before the trend peaks.*

| ID | User story | Status in MVP |
|---|---|---|
| US-1 | As a creator, I search a keyword and see the matching videos ranked by how viral they are. | Built |
| US-2 | As a creator, I choose TikTok, YT Shorts or YouTube so the results match the format I make. | Built (one platform per search) |
| US-3 | As a marketer, I limit results to the last 24 hours, week, month, 3 months or all time so I see current trends. | Built |
| US-4 | As a researcher, I re-sort by views/hour, total views, engagement or newest without searching again. | Built (client-side) |
| US-5 | As a manager, I hide small videos with a minimum-views filter. | Built (client-side, applies to results already loaded) |
| US-6 | As a user, I load more results when the first page isn't enough. | Built (cursor pagination) |
| US-7 | As a manager, I share a link that reproduces my search. | Built (`?q=&platform=&range=` restored on load) |
| US-8 | As a user, I open the original video in a new tab. | Built |
| US-9 | As a creator, I compare results across all platforms in one list. | Not built (v1.1) |
| US-10 | As a manager, I save searches and export results to CSV. | CSV export built (v2 part 1); saved searches not built (v2 part 2) |

### 1.5 Goals and non-goals

**Goals (MVP)**
1. A keyword search returns ranked, decision-ready results in one step, with no sign-up.
2. Rank by **growth speed and engagement**, not raw popularity.
3. Keep the API key secret and the cost per search predictable (one upstream call per search or Load more).
4. Zero-ops deployment: static hosting plus one serverless function on Netlify.

**Non-goals (MVP)**
- User accounts, saved searches, alerts or history.
- Downloading or re-hosting videos (the app only links out to the platform).
- Creator or profile analytics, follower data, or tracking a video over time.
- Instagram, Facebook, X and other platforms.
- Guaranteed accuracy of upstream metrics (we pass through what ScrapeCreators returns).
- Monetization, billing or per-user quotas.

### 1.6 Success metrics (KPIs)

No analytics are built in today. The baselines below need instrumentation (see Open Questions).

| Category | KPI | Definition | Initial target |
|---|---|---|---|
| Activation | Search success rate | Searches returning 1 or more results without error ÷ all searches | ≥ 95% |
| Activation | Time to first result | Submit to first render (p50 / p95) | ≤ 3 s / ≤ 8 s |
| Engagement | Click-through to video | Sessions with 1 or more outbound video clicks ÷ sessions with results | ≥ 40% |
| Engagement | Searches per session | Mean | ≥ 2.5 |
| Retention | W1 / W4 returning visitors | Visitors who return in week 1 / week 4 | ≥ 25% / ≥ 10% |
| Virality | Share-link visits | Sessions arriving with `?q=` in the URL | ≥ 10% of sessions |
| Cost | Credits per useful result | ScrapeCreators credits used ÷ outbound clicks | Track; reduce 20% by v1.1 |
| Quality | Error rate | 4xx/5xx from `/api/search` ÷ requests | ≤ 2% (excluding empty-query 400s) |
| Quality | Score usefulness | Share of outbound clicks landing on the top 10 by viral score | ≥ 60% |

### 1.7 Functional requirements (MVP, as built)

Priority: **P0** = MVP cannot ship without it; **P1** = important, shipped; **P2** = nice to have, shipped.

| ID | Requirement (testable) | Priority |
|---|---|---|
| FR-1 | The system SHALL accept a keyword of 1-200 characters (after trimming). An empty query returns HTTP 400 "Enter a search term."; more than 200 characters returns 400 "Search term is too long." | P0 |
| FR-2 | The system SHALL search exactly one platform per request: `tiktok` (default), `shorts` or `youtube`. Any other value returns 400 "Unknown platform." | P0 |
| FR-3 | The function SHALL call ScrapeCreators with the key from `SCRAPECREATORS_API_KEY`. If the key is missing it returns 500 with a setup message. The key SHALL never reach the browser. | P0 |
| FR-4 | The function SHALL turn every result into one shape: `platform, id, url, title, thumbnail, author, handle, views, likes, comments, shares, publishedAt, durationSec`. | P0 |
| FR-5 | The system SHALL support date ranges `day`, `week` (default), `month`, `3months` and `all`, mapped to each platform's own filter values. An invalid range falls back to `week`. | P0 |
| FR-6 | The system SHALL work out views/hour = views ÷ max(hours since publish, 1), and engagement = (likes + comments + shares) ÷ views. | P0 |
| FR-7 | The system SHALL work out a viral score from 0 to 100 = round(14·log10(views/hr + 1) + 150·min(engagement, 0.2)), clamped to the 0-100 range. When engagement is unknown it adds a neutral 10 points; when age is unknown it assumes the video is 720 hours (30 days) old. | P0 |
| FR-8 | Results SHALL be sorted by viral score by default and can be re-sorted by views/hr, views, engagement or newest without a new API call. | P0 |
| FR-9 | Each card SHALL show the thumbnail, platform badge, duration, score, title (linked), author/handle, views, views/hr, engagement and age. Links open in a new tab with `noopener noreferrer`. | P0 |
| FR-10 | Duplicate video IDs SHALL be removed on the server (within a page) and in the browser (across pages). | P1 |
| FR-11 | **Load more** SHALL fetch the next page using the platform cursor. It is hidden when there is no cursor or when a page adds no new videos. | P1 |
| FR-12 | The min-views filter (Any / 10K / 100K / 1M / 10M+) SHALL apply in the browser, and the status line SHALL say how many results it hides. | P1 |
| FR-13 | The search SHALL be written to the URL, and a URL with `q` SHALL re-run that search on load. | P1 |
| FR-14 | Errors from upstream SHALL show as a 502 with a readable message in the status area, which is an `aria-live` region. Empty states SHALL suggest what to try next. | P1 |
| FR-15 | Successful responses SHALL be cacheable for 5 minutes (`cache-control: public, max-age=300`). | P2 |
| FR-16 | YouTube long-form cards SHALL use a wide (16:9) layout; TikTok and Shorts cards use a vertical layout. | P2 |

### 1.8 Release roadmap

| Release | Theme | Scope (priority) |
|---|---|---|
| **MVP (current)** | Single-platform viral search | FR-1 to FR-16 above |
| **v1.1** (built 2026-10-20, see "Shipped in v1.1") | Trust, measurement, cost | P0: privacy-friendly analytics for the KPIs in 1.6. P0: rate limiting or abuse protection on `/api/search`. P0: fix the YouTube "Last 3 months" mapping, which currently maps to `this_year`. P1: "All platforms" mode that merges the three sources into one ranked list. P1: show the score breakdown in a tooltip. P1: persist sort and min-views in the URL. P2: internal monitoring of credits remaining (returned by the function today but never shown or alerted on). |
| **v2** (+1-2 quarters; part 1 built 2026-10-20, see "Shipped in v2 part 1") | Workflow and retention | P0: accounts with saved searches and history. P1: CSV export and copy-to-clipboard. P1: trend alerts (email when a saved keyword gets a video above a score threshold). P1: track a video's views over time to measure real growth speed. P2: more platforms (Instagram Reels) where ScrapeCreators supports them. P2: tune the score per platform. P2: paid tier with quotas if the cost per active user justifies it. |

### 1.9 Assumptions

- ScrapeCreators endpoints (`/v1/tiktok/search/keyword`, `/v1/youtube/search`) and their field names stay stable. A schema change would silently produce null metrics.
- Views from a single snapshot divided by video age is a good enough stand-in for growth speed in an MVP. It overstates older videos that grew early and then stalled.
- YouTube's `publishedTime` can be parsed by `new Date()`. If it is relative text (for example "2 days ago"), views/hr falls back to the 30-day assumption.
- Users accept one platform per search for now.
- Upstream sort orders (TikTok `relevance`, YouTube `popular`) bring enough high-growth candidates into the first pages for the client-side ranking to surface them.
- Traffic is low enough that a shared API key and Netlify's free/standard limits are enough.

### 1.10 Open questions

1. **Cost:** How many credits does each TikTok or YouTube call cost, and what monthly budget do we have? This drives rate limits and whether a merged "All platforms" search (three calls) is affordable.
2. **Analytics:** Which tool is acceptable (Plausible, Netlify Analytics, none), and what are the privacy or consent requirements?
3. **Abuse:** The endpoint is public and unauthenticated. Do we need IP rate limiting, a CAPTCHA or a referrer check before promoting the site?
4. **Score validity:** Are the weights (14× log speed, up to 30 points from engagement) validated against user judgment? YouTube reports no shares, which lowers its engagement, so should scores be comparable across platforms at all?
5. **Date semantics:** TikTok "day" maps to `yesterday` and YouTube "3months" maps to `this_year`. Should the UI labels change, or should results be filtered on the server by `publishedAt`?
6. **Min-views filter:** Should it be sent to the API (if supported) so users don't spend credits on pages that get filtered out?
7. **Legal/ToS:** Are we comfortable showing third-party thumbnails (hotlinked with `no-referrer`), and how do platform terms affect a commercial launch?
8. **Primary persona:** Should v2 be built for solo creators (simple, free) or agencies (exports, collaboration, paid)?


---

## 2. User Experience & Design (UX/UI Designer)

### 2.1 Design principles

1. **One box, instant signal.** A keyword and Enter should get ranked results. Every other control is optional and already has a sensible default (TikTok, This week, Viral score, Any views).
2. **Numbers you can scan.** Cards lead with the metrics creators compare: viral score, views/hour, views, engagement and age. They use compact numbers and tabular figures.
3. **Explain the score.** A 0-100 score that nobody understands won't be trusted. Users must be able to learn what it measures without leaving the page.
4. **Never a dead end.** Every empty, error or filtered state tells the user what happened and what to do next, in plain language.
5. **Shareable by default.** The URL is the state. A link someone pastes should reproduce what they saw.
6. **Accessible and mobile-first.** WCAG 2.2 AA, usable at 360px wide, with keyboard and screen-reader support at the same level as pointer use.

### 2.2 Primary user flows

**F1: Search**
1. User types a keyword and optionally picks a platform (segmented control) and a "Posted" range.
2. User presses Enter or Search. The query `q, platform, range` is written to the URL with `history.replaceState`, the grid clears, Search is disabled and the status line reads "Searching…" (live region).
3. Results render sorted by the current Sort, and the status shows "N videos for "q"".

**F2: Refine**
- *Client-side (instant):* changing Sort or Min views re-renders the cached list with no network call. The status reports "(N hidden by min views)".
- *Server-side (requires re-submit):* changing Platform or Posted does nothing until the user presses Search again. **Gap:** nothing tells the user that the results on screen are now stale.

**F3: Load more**
1. A "Load more" button appears below the grid while the API returns a cursor.
2. On click, both buttons are disabled and the status reads "Loading more…". New items are de-duplicated by `id`, merged into the list and re-sorted, so the new cards are mixed in rather than added at the bottom.
3. When a page returns no new items, the cursor is cleared and the button hides. **Gap:** there is no "End of results" message, and because of the re-sort, keyboard and screen-reader users can't find what was added.

**F4: Open video**
- The thumbnail and the title both open the platform URL in a new tab (`noopener noreferrer`). **Gap:** that makes two tab stops per card that go to the same place, and nothing says the link opens a new tab.

**F5: Share a search link**
- Copying the address bar shares `?q&platform&range`, and on load the app restores those values and calls `requestSubmit()`. **Gaps:** Sort and Min views are not in the URL, so a recipient sees a different ranking. There is also no visible "Copy link" control, which on mobile means digging into browser chrome.

### 2.3 Screen and component inventory

A single page (`index.html`) with these parts:

| Component | Notes |
|---|---|
| Search panel | `input[type=search]` (visually hidden label, `required`, max 200), primary Search button |
| Platform segmented control | `fieldset` with legend, 3 radios: TikTok / YT Shorts / YouTube |
| Posted select | Last 24 hours, This week, This month, Last 3 months, All time |
| Sort select | Viral score, Views per hour, Total views, Engagement rate, Newest |
| Min views select | Any, 10K+, 100K+, 1M+, 10M+ |
| Status line | `role=status aria-live=polite`; `.error` modifier |
| Results grid | `section aria-label="Results"`, auto-fill 240px columns |
| Video card | Thumbnail link (platform badge, duration, score badge), title link (2-line clamp), author/handle, `dl` with Views, Views/hr, Engagement, Posted. YouTube long-form cards use 16:9, all others 9:12 |
| Load more | Secondary action, hidden when there is no cursor |

### 2.4 UI states

| State | Current behavior | Required behavior |
|---|---|---|
| **Empty (first visit)** | Blank status, empty grid | Short explainer plus 4-6 example keyword chips (for example "gym tips", "AI tools"). Tapping a chip runs a search. |
| **Loading (new search)** | Grid cleared, "Searching…", Search disabled | Show 8 skeleton cards with the same dimensions as real cards, set `aria-busy="true"` on the grid, keep the status text, and use no shimmer under `prefers-reduced-motion`. |
| **Loading more** | "Loading more…", buttons disabled | Same, plus 4 skeletons after the existing cards and a spinner or label inside the Load more button. |
| **Results** | "N videos for "q"" | Same, plus the active platform and range, for example "48 TikTok videos · This week". |
| **No results** | "No videos found. Try a broader keyword or a longer time range." | Keep the copy and add one-click actions: "Try All time" and "Try another platform". |
| **Filtered out** | "No videos match the min views filter. Try lowering it." | Add a "Reset min views" button. Keep showing "(N hidden)" when only some results are filtered. |
| **Upstream error (502)** | Red status text "Search failed: <raw upstream message>" | An error panel in plain language with a Retry button. Put the raw message in a `<details>` element. On a Load more failure, keep existing cards (as today) and put Retry on the Load more button. |
| **Missing key (500)** | Shows "Server is missing SCRAPECREATORS_API_KEY. Add it in Netlify environment variables." to every visitor | End users see "Search is temporarily unavailable. We're on it." The operator text is logged on the server only, or shown only on localhost/deploy previews. |
| **Out of credits** | Not distinguished. It falls into the generic 502 and returns `credits_remaining`, which the UI ignores. | The function maps the provider's credit/402 error to a typed `code: "OUT_OF_CREDITS"`. The UI shows "Daily search limit reached. Try again later." and disables Search with an explanation. It does not show a red error loop. |
| **Stale results** | Not handled | When Platform or Posted differs from the last search, show an inline note "Filters changed. Search again to update" next to the Search button. Better still, re-run the search automatically on change (debounced) once a query exists. |
| **Missing data** | Shows "—" | Keep "—", and give it an accessible name ("not available") plus a tooltip explaining why, for example "YouTube doesn't report shares". |
| **Thumbnail missing or failed** | `img` removed, grey box | Add an `onerror` fallback to a platform glyph so a broken-image icon never shows. |

### 2.5 Responsive behavior

- **≥ 1024px:** 4-5 columns (max-width 1180px), with controls on one row.
- **521-1023px:** 2-4 columns from auto-fill. Controls wrap with a 12px/18px gap.
- **≤ 520px (current breakpoint):** the search row stacks so the button is full width, the grid is fixed at 2 columns with a 10px gap, and stats are a single column.
- **360px target:** each card is about 159px wide. Requirements:
  - Badges must not overlap. Below 400px, hide the duration badge or move it under the thumbnail.
  - The title clamp stays at 2 lines.
  - The segmented control (about 260px) must fit without horizontal scroll.
  - The three selects should share a 2-column sub-grid with Sort at full width, so that labels don't wrap unevenly.
  - Use the 16px side gutter from `.wrap`, and allow no horizontal page scroll at 320px (WCAG 1.4.10 Reflow).
- Search panel controls on mobile should collapse behind a "Filters (n)" disclosure that shows how many filters differ from the defaults, so results stay above the fold.
- Every touch target must be at least 24×24 CSS px (WCAG 2.5.8). Primary actions should be 44px.

### 2.6 Accessibility requirements (WCAG 2.2 AA)

- **Contrast (1.4.3 / 1.4.11):** white text on the `--accent-2` (#ff9a3c) end of the button and score-badge gradient is about 2.2:1, which **fails**. Fix by darkening the gradient (≥ 4.5:1 for button text) or switching to dark text. The error color `#ff4d5e` on the light theme background is about 3.1:1, which **fails**. Use a darker red such as #c81e33 in light mode. Focus rings must reach 3:1 against both themes.
- **Keyboard order:** search input → Search → platform radios (arrow keys inside the group) → Posted → Sort → Min views → (Copy link) → cards in visual order → Load more → footer link. **One tab stop per card:** remove the thumbnail link from the tab order (`tabindex="-1"`, `aria-hidden="true"`) and keep the title link as the single accessible link.
- **Focus management:** after Load more, move focus to the first newly added card, or announce "12 more videos loaded". `render()` currently rebuilds the grid with `replaceChildren` on every Sort or Min views change, which destroys focus on any card. After a new search, keep focus on the input. On a fatal error, move focus to the error panel.
- **Names and semantics:**
  - Make each card title a heading (`h2`/`h3`) wrapping the link, so screen-reader users can jump between results by heading.
  - The score badge reads "fire 72", and its `title` attribute is unavailable to keyboard and touch users. Give it the text "Viral score 72 of 100" and hide the emoji with `aria-hidden`.
  - Add "(opens in new tab)" as visually hidden text on external links.
  - Remove the redundant `aria-label` on the platform fieldset (the legend is enough).
- **Status messages (4.1.3):** keep the polite live region. Errors use `role="alert"`, and the status must not be overwritten on every re-sort.
- **Reduced motion (2.3.3 advisory):** skeleton shimmer and any scroll-into-view respect `prefers-reduced-motion: reduce`.
- **Resize and spacing (1.4.4 / 1.4.12):** no clipped stats at 200% zoom or with text-spacing overrides.
- **Images:** decorative thumbnails keep `alt=""` because the title carries the meaning.

### 2.7 Prioritized UX improvements

**P0: ship before launch**
1. Fix the failing contrast on the gradient button, score badge and light-mode error text.
2. Hide the operator-facing missing-key message from end users. Add a distinct, friendly out-of-credits state (requires a typed `code` from the function).
3. One tab stop per card, plus an accessible score label ("Viral score 72 of 100").
4. Error panel with a Retry button instead of raw red text.
5. Preserve focus across re-render and Load more, and announce how many items were added.

**P1: next iteration**
1. Put `sort` and `minViews` in the URL, and add a "Copy link" button with "Link copied" confirmation in the live region.
2. Stale-filter handling: auto-rerun the search when Platform or Posted changes (or show an inline notice).
3. Skeleton loading cards with reduced-motion support.
4. A first-visit empty state with example keyword chips. Add recovery buttons to the no-results and filtered-out states.
5. Score explainer: an "i" button next to Sort that opens a popover ("Mostly views per hour, plus engagement").
6. Show "End of results" when the cursor runs out.

**P2: polish**
1. A mobile "Filters (n)" disclosure.
2. Thumbnail error fallback, and tooltips on "—" explaining missing metrics.
3. Make range labels honest per platform. YouTube has no "last 3 months" filter, and "Last 3 months" currently maps to *this year*, so either relabel the option for YouTube or filter on the client.
4. Recent searches as chips (stored in the browser).
5. Ask creators whether they want new results added at the bottom instead of re-sorted into the list, and offer that as a toggle.


---

## 3. Technical Architecture (Software Architect)

This section documents what exists in the repo today (`netlify/functions/search.mjs`, `public/app.js`, `netlify.toml`) and specifies the changes needed to make it production-ready. Items marked **[Current]** describe shipped behavior. Items marked **[Required]** or **[Recommended]** are work still to do.

### 3.1 Architecture Overview

Viral Finder is a static single-page frontend plus one serverless proxy. The browser never sees the ScrapeCreators API key. All scoring (viral score, velocity, engagement) runs on the client. The function only fetches, normalizes and de-duplicates.

```
 Browser (public/index.html + app.js)
   |  GET /api/search?q=&platform=&range=&cursor=
   v
 Netlify CDN (static assets; caches function responses per Cache-Control)
   |
   v
 Netlify Function  netlify/functions/search.mjs   (path: /api/search)
   |  validate -> map params -> call upstream -> normalize -> dedupe
   |  header x-api-key: $SCRAPECREATORS_API_KEY
   v
 ScrapeCreators API  https://api.scrapecreators.com
   ├─ /v1/tiktok/search/keyword   (query, date_posted, sort_by, cursor, trim)
   └─ /v1/youtube/search          (query, uploadDate, sortBy, type, continuationToken)
```

The app is stateless. There is no database, no user accounts and no server-side session. Shareable state lives in the URL (`?q=&platform=&range=`), which `app.js` restores on load.

### 3.2 Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (ES2020+). No framework and no build step. Uses `<template>` cards and the `Intl.NumberFormat` compact notation. |
| Backend | Netlify Functions v2 (Web `Request`/`Response` API, `export const config = { path }`), ESM, bundled with esbuild |
| Runtime | Node.js >= 18 (global `fetch`) |
| Upstream | ScrapeCreators REST API (paid, credit-metered) |
| Hosting/CI | GitHub repo, with Netlify continuous deployment |
| Dev tooling | Netlify CLI (`npm run dev` runs `netlify dev`) |

### 3.3 Repo Layout

```
/
├─ public/                 # published static site (netlify.toml: publish = "public")
│  ├─ index.html           # search form, results grid, card <template>
│  ├─ app.js               # fetch, enrich (score/velocity/engagement), sort/filter, render
│  └─ styles.css
├─ netlify/functions/
│  └─ search.mjs           # /api/search proxy + normalization
├─ docs/prd/               # this PRD
├─ netlify.toml            # build + functions config (esbuild bundler)
└─ package.json            # "type": "module", engines node >= 18
```

### 3.4 `/api/search` Contract

**Method:** `GET /api/search`

| Param | Required | Values | Default | Notes |
|---|---|---|---|---|
| `q` | yes | 1–200 chars after trim | — | 400 if empty or too long |
| `platform` | no | `tiktok`, `youtube`, `shorts` | `tiktok` | 400 if unknown |
| `range` | no | `day`, `week`, `month`, `3months`, `all` | `week` | An invalid value falls back to `week` silently |
| `cursor` | no | opaque string from previous response | — | Passed through as TikTok `cursor` or YouTube `continuationToken` |

**Upstream parameter mapping [Current]:**

| `range` | TikTok `date_posted` | YouTube `uploadDate` |
|---|---|---|
| day | `yesterday` | `today` |
| week | `this-week` | `this_week` |
| month | `this-month` | `this_month` |
| 3months | `last-3-months` | `this_year` (approximation, wider than 3 months) |
| all | `all-time` | *(omitted)* |

The function fixes sort order upstream: TikTok uses `sort_by=relevance` and YouTube uses `sortBy=popular`. TikTok also sends `trim=true` to shrink the payload. For YouTube, `type` is `videos` or `shorts`.

**Success response (200):**

```json
{
  "items": [Video, ...],
  "cursor": "string | number | null",
  "credits": 1234
}
```

`cursor: null` means there are no more pages. `credits` is the upstream `credits_remaining` and may be `undefined`.

**Error response:** `{ "error": "human-readable message" }`

| Status | Cause [Current] |
|---|---|
| 400 | Missing `q`, `q` over 200 chars, unknown `platform` |
| 500 | `SCRAPECREATORS_API_KEY` not configured |
| 502 | Any upstream failure: non-2xx, `success:false`, network error, or non-JSON body. The message is `Search failed: <upstream message>` |

**[Required] error refinement:** today every upstream failure becomes a 502. Map upstream statuses so the UI can respond correctly. Also add a machine-readable `code` field next to `error`.
- Upstream 401/403 → 500 `{code:"config"}` (bad key; operator problem, not user problem)
- Upstream 402 or credits exhausted → 503 `{code:"credits"}`
- Upstream 429 → 429 `{code:"rate_limited"}` with `Retry-After` passed through
- Timeout → 504 `{code:"timeout"}`
- Do not echo raw upstream bodies to the client beyond a short message.

### 3.5 Normalized `Video` Data Model

```ts
type Video = {
  platform: "tiktok" | "youtube" | "youtube-shorts";
  id: string;              // platform-native id; dedupe key
  url: string;             // canonical watch URL
  title: string;           // caption/title, "" if absent
  thumbnail: string;       // "" if absent
  author: string;          // display name
  handle: string;          // username/handle, "" if absent
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;   // always null for YouTube
  publishedAt: string | null; // ISO-8601 (TikTok) or relative text (YouTube, see risk R2)
  durationSec: number | null;
};
```

The client adds the derived fields `velocity` (views/hour), `engagement` ((likes+comments+shares)/views) and `score` (0–100) in `enrich()`. These fields are never sent by the server.

**Field mapping:**

| Video field | TikTok (`search_item_list[].aweme_info` or the item itself) | YouTube (`videos[]`, `shorts[]`, `shelves[].items[]`) |
|---|---|---|
| platform | `"tiktok"` | `type === "short"` → `youtube-shorts`, else `youtube` |
| id | `aweme_id` (items without it are dropped) | `id` (items without it are dropped) |
| url | `https://www.tiktok.com/@{author.unique_id}/video/{aweme_id}` | `url` or `https://www.youtube.com/watch?v={id}` |
| title | `desc` | `title` |
| thumbnail | `video.origin_cover.url_list[0]`, then `video.cover.url_list[0]` | `thumbnail` |
| author | `author.nickname`, then `unique_id` | `channel.title` |
| handle | `author.unique_id` | `channel.handle` |
| views | `statistics.play_count` | `viewCountInt` |
| likes | `statistics.digg_count` | `likeCountInt` |
| comments | `statistics.comment_count` | `commentCountInt` |
| shares | `statistics.share_count` | — (null) |
| publishedAt | `create_time` (unix s) → ISO | `publishedTime` |
| durationSec | `duration` (s), then `video.duration` (ms) / 1000 | `lengthSeconds` |

The function de-duplicates by `id` within each page. The client de-duplicates again across pages.

### 3.6 Pagination

The cursor is opaque and comes from upstream. `app.js` keeps `state.cursor` and shows "Load more" while the cursor is non-null. If a page adds no new (non-duplicate) items, the client sets the cursor to null to stop endless loops. **[Recommended]** Cap pagination at 10 pages per query on the client, since each page costs credits.

### 3.7 Caching

- **[Current]** Successful responses send `cache-control: public, max-age=300`. Browsers cache for 5 minutes, and the URL includes all params, so the cache key is correct.
- **[Required]** Add `Netlify-CDN-Cache-Control: public, s-maxage=600, stale-while-revalidate=300` (or `durable`). With this, identical searches from different users are served from Netlify's edge and spend no ScrapeCreators credits. The function must not cache error responses (it does not today).
- **[Recommended]** Normalize the cache key: lowercase `q` and collapse its whitespace on the client before the request, so "Cats" and "cats " hit the same entry.

### 3.8 Performance and Latency Targets

| Metric | Target |
|---|---|
| Static page LCP (4G mobile) | < 1.5 s |
| `/api/search` p50, cache miss | < 2.5 s |
| `/api/search` p95, cache miss | < 6 s |
| `/api/search` CDN cache hit | < 150 ms |
| Function self-overhead (normalize + dedupe) | < 50 ms |
| Upstream timeout | 8 s **[Required]**, via `AbortSignal.timeout(8000)` |

Today there is no upstream timeout, so a hung upstream call runs until the Netlify limit (10 s by default) and the client gets an opaque failure. Add the timeout so the function returns a clean 504.

### 3.9 Credit and Rate-Limit Handling

Each upstream call consumes ScrapeCreators credits. The CDN cache absorbs repeat searches before they reach the function, which makes it the main guard against waste.
- **[Current]** `credits_remaining` is returned to the client but not used.
- **[Required]** Log `credits_remaining` on every call. Emit a warning log when it falls below a threshold (env `CREDITS_WARN_AT`, default 1000).
- **[Required]** Debounce on the client: the search button is already disabled while loading. Keep it that way, and ignore duplicate submissions.
- **[Recommended]** Throttle abuse with Netlify rate limiting (`config.rateLimit`, e.g. 30 req/min per IP). This protects credits from scrapers hitting the public endpoint.
- Do not retry 4xx responses. Retry once, with jitter, only on upstream 5xx or network errors.

### 3.10 Configuration and Deployment

| Env var | Scope | Purpose |
|---|---|---|
| `SCRAPECREATORS_API_KEY` | Functions, secret | Upstream auth (required) |
| `CREDITS_WARN_AT` | Functions | Low-credit log threshold (optional) |

- **Pipeline:** push to `main` triggers a Netlify production deploy. Pull requests get Deploy Previews. Previews use the same key unless a separate key is scoped to the "Deploy Previews" context; a separate key is recommended so test traffic stays isolated.
- No build command is needed. Netlify publishes `public/` and bundles `netlify/functions/*` with esbuild.
- **Local dev:** `npm i -g netlify-cli`, then `netlify link`, then `netlify dev`. The CLI serves `public/` and the function on one port and injects site env vars. You can also put `SCRAPECREATORS_API_KEY` in a git-ignored `.env`.
- The key must never appear in `public/`, logs or the repo. Turn on Netlify's secret scanning.

### 3.11 Testing Strategy

There are no tests today.
- **Unit (Vitest or `node:test`):** `normalizeTikTok` and `normalizeYouTube` against recorded fixture JSON. Cover these cases: missing stats, `aweme_info` vs. flat items, ms vs. s duration, shelves, and items without ids. The date mapping tables need tests too. In `app.js`, extract `viralScore`, `engagementRate` and `hoursSince` into a module so they can be tested.
- **Handler tests:** call the default export with a constructed `Request` and a stubbed `global.fetch`. Assert the 400/500/502/504 paths, de-duplication and cache headers.
- **Contract fixtures:** capture real upstream responses once (manually, since CI has no key). Store them in `test/fixtures/`. Refresh them monthly so schema drift shows up.
- **Smoke test:** after each production deploy, a scheduled job runs one cheap query and checks that the response has 200 status and a non-empty `items`.
- **CI:** a GitHub Action runs the tests on each PR. Branch protection blocks merge on failure.

### 3.12 Observability

- Structured `console.log(JSON.stringify({...}))` per request with these fields: platform, range, q length (not the raw query if privacy matters), upstream status, latency in ms, item count, `credits_remaining` and error code. Logs appear in Netlify Function logs.
- Alerts: error rate > 5% over 15 min, p95 > 6 s, or credits below threshold. The options are a Netlify log drain (Pro) or the smoke-test job posting to email/Slack.
- Front-end errors can be captured with a lightweight beacon. This is optional and should stay privacy-respecting.

### 3.13 Technical Risks and Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Upstream schema changes (field renames, `aweme_info` nesting, YouTube shelves) silently empty the results | Defensive optional chaining (already present); fixture tests; log when the raw item count is > 0 but the normalized count is 0 |
| R2 | YouTube `publishedTime` may be relative text ("3 days ago"), which breaks velocity and age | Parse relative strings to ISO on the server; return null when unparseable |
| R3 | `3months` maps to YouTube `this_year`, which over-fetches older videos | Filter on the server by `publishedAt` when parseable; document the approximation in the UI |
| R4 | Credit exhaustion or abuse of the public endpoint | CDN caching, per-IP rate limit, low-credit alerts, a clear 503 `credits` UX |
| R5 | Upstream latency or hangs exceed the function timeout | 8 s `AbortSignal` timeout plus a 504 with a retry prompt |
| R6 | Thumbnail CDN hotlink blocking or expiring TikTok signed URLs | `referrerPolicy="no-referrer"` (present); placeholder on `img` error; optional image proxy later |
| R7 | Key leakage via logs or previews | Key stays server-only; never log headers; separate preview-context key |
| R8 | ScrapeCreators outage or vendor lock-in | Isolate upstream calls behind `searchTikTok` and `searchYouTube` adapters so a second provider can be added without changing the `Video` contract |


---

## 4. Data, Metrics & Virality Scoring (Data Scientist)

### 4.1 Source fields (as normalized in `netlify/functions/search.mjs`)

| Field | TikTok | YouTube / Shorts |
|---|---|---|
| `views` | `statistics.play_count` | `viewCountInt` |
| `likes` | `statistics.digg_count` | `likeCountInt`, **usually absent in search** |
| `comments` | `statistics.comment_count` | `commentCountInt`, **usually absent** |
| `shares` | `statistics.share_count` | always `null` |
| `publishedAt` | `create_time` (epoch s → ISO) | `publishedTime` (passed through as-is) |

All counts are point-in-time snapshots taken at search time. TikTok counts are exact. YouTube counts may be rounded.

### 4.2 Metric definitions (v1, the MVP formula; replaced by v1.1a in `public/score.js`, kept as `scoreV1` for tests)

**Age (hours).** `h = max((now − publishedAt) / 3.6e6 ms, 1)`. Edge cases:
- If the date is missing or can't be parsed, `h = null`. That covers a relative string like "2 days ago", which is possible with YouTube's `publishedTime`. **Action:** confirm that the YouTube format is ISO. If it isn't, parse it on the server.
- Posts younger than 1 h are clamped to 1 h, so their velocity equals their raw views.

**Views.** Integer, or `null` when not reported. The min-views filter treats `null` as 0, so those cards are hidden.

**Velocity (views/hour).** `velocity = views / h`. It is `null` when `h` or `views` is `null`. This is a lifetime average, not the current rate.

**Engagement rate (dimensionless, shown as %).**

$$E = \frac{\text{likes} + \text{comments} + \text{shares}}{\text{views}}$$

Missing comments or shares count as 0.

| Condition | Result |
|---|---|
| `views` is 0 or `null` | `E = null` |
| `likes == null` | `E = null`. This is typical for YouTube. |
| On YouTube, when likes are present | Shares are always 0, so YouTube E is biased low |
| Very small `views` | High variance. 5 likes on 20 views gives 25%. |

**Viral score (0–100, integer).**

$$S = \operatorname{clip}_{[0,100]}\Big(\underbrace{14\log_{10}(\text{vel}+1)}_{\text{speed}} + \underbrace{\begin{cases}10 & E=\text{null}\\ 150\cdot\min(E,0.2) & \text{otherwise}\end{cases}}_{\text{engagement, max }30}\Big)$$

When age is unknown, `vel = views / 720`, which treats the post as 30 days old.

### 4.3 Critique of the current score

**Worked examples** (computed with the exact v1 formula):

| # | Video | Views | Age | E | vel | Speed | Eng | **S** |
|---|---|---|---|---|---|---|---|---|
| A | TikTok hit | 500k | 10 h | 13% | 50,000 | 65.8 | 19.5 | **85** |
| B | YouTube, same reach | 500k | 10 h | null | 50,000 | 65.8 | 10 | **76** |
| C | Tiny TikTok | 2,000 | 2 h | 25% → capped at 20% | 1,000 | 42.0 | 30 | **72** |
| D | Same as A, but likes = 0 reported | 500k | 10 h | 0% | 50,000 | 65.8 | 0 | **66** |
| E | YouTube evergreen | 50M | 3 y | null | 1,903 | 45.9 | 10 | **56** |
| F | Same as E, but date unparseable | 50M | ? | null | 69,444 | 67.8 | 10 | **78** |

**Findings**

1. **Platform bias.** A and B have the same reach and speed, yet TikTok scores 9 points higher. That is purely because TikTok reports likes. The neutral value of 10 implies E ≈ 6.7%. That is below typical TikTok engagement (roughly 8–12%) but above typical YouTube long-form engagement (roughly 2–4%). Scores are therefore not comparable across tabs.
2. **Small-sample inflation.** In C, a 2k-view clip scores within 4 points of a 500k-view YouTube video. On tiny denominators, engagement adds up to 30 points without any shrinkage.
3. **Missing beats zero.** D scores 10 points below "unknown", so reporting data is penalized.
4. **Age bias.** Views accumulate concavely, and $v/h$ falls roughly as $h^{-0.4}$ even for videos that keep growing. Very new posts are over-rewarded, and the 1-hour clamp amplifies this. Long-tail hits are under-rewarded (E).
5. **Missing-date inflation.** F scores 22 points above E only because its date didn't parse.
6. **Compressed and unreachable range.** Reaching 100 requires about 100k views/h plus 20% engagement. Without engagement data, the practical ceiling is about 85–90. Most results cluster between 40 and 75, which makes the badge weakly informative.
7. **Inconsistent time windows.** The "3 months" option maps to `this_year` on YouTube and to "last-3-months" on TikTok. The "day" option maps to "yesterday" and "today" respectively.

### 4.4 Recommended v1.1 model

**Design goals:** comparable within a platform, robust to missing data, and honest about confidence.

**Step 1: age-adjusted velocity.**

$$V^* = \frac{\text{views}}{(h + h_0)^{\beta}},\quad h_0 = 2,\ \beta = 0.6 \text{ (initial guess, to be tuned per platform)}$$

The $h_0$ term removes the 1-hour cliff. Setting $\beta < 1$ matches concave view growth. For an unknown age, mark the component as missing. Do not impute 30 days.

**Step 2: shrunk engagement.** Weight interactions by intent and apply a Bayesian prior per platform $p$:

$$I = \text{likes} + 2\cdot\text{comments} + 3\cdot\text{shares},\qquad \tilde E = \frac{I + k\,\mu_p}{\text{views} + k}$$

Use $k = 5{,}000$ views. Set $\mu_p$ to the platform's median engagement, seeded from logged results (§4.6) and initially 0.10 for TikTok and 0.03 for YouTube. Example C becomes $\tilde E = (400 + 2\cdot30 + 3\cdot70 + 500)/7{,}000 \approx 0.17$. That is still high, but no longer maxed out.

**Step 3: percentiles within each platform.** Convert each component to a percentile $P \in [0,1]$ against a reference distribution for that platform and age bucket: <24 h, 1–7 d, 7–30 d, and >30 d.
- **v1.1a (free).** The reference is the current result set. This needs at least 20 items, or the fallback in v1.1b applies.
- **v1.1b.** The reference is a rolling, server-maintained table of per-platform quantiles, built from aggregate logging (§4.6).

**Step 4: combine, renormalizing over the components that are available.**

$$S = 100\cdot\frac{\sum_c w_c P_c}{\sum_{c\in\text{avail}} w_c},\qquad w_{\text{vel}} = 0.6,\ w_{\text{eng}} = 0.25,\ w_{\text{outlier}} = 0.15$$

Show a **confidence tag**: *High* when all components are present, *Medium* when only velocity and engagement are present, *Low* when only velocity is present or views < 1,000. Missing data then lowers confidence instead of shifting the score.

**Step 5 (optional): follower-relative "outlier" component.** It requires extra API calls:

$$O = \frac{\text{views}}{\operatorname{median}(\text{views of creator's last } n \text{ posts})}$$

When post history isn't available, fall back to $\text{views}/\text{followers}$.

| Enrichment | Endpoint type | Calls | Est. credits* |
|---|---|---|---|
| Base search page | search | 1 | 1 |
| Creator profile or recent posts (≈15 unique creators/page) | profile | ~15 | ~15 |
| YouTube video details for likes and comments (top 10) | video | 10 | 10 |

\*This assumes roughly 1 credit per request. Verify against current ScrapeCreators pricing before building.

Enriching a full page multiplies its cost about 15–25×. **Recommendation:** make "Deep score" opt-in, apply it to the top 10 only, and cache creator profiles server-side for 24 h, keyed by platform and handle. Track `credits_used` per search (§4.6) to manage the budget.

**Implementation notes (v1.1a, built 2026-10-20 in `public/score.js`).** No extra API calls, so the outlier component is never available and the best confidence is *Medium*.
- Steps 1-4 as written: $h_0 = 2$, $\beta = 0.6$, $k = 5{,}000$, $\mu$ = 0.10 TikTok and 0.03 YouTube **and Shorts**, weights 0.6 / 0.25 / 0.15. Age is unclamped (no 1-hour floor).
- **Reference set.** Percentiles are computed per platform, so "All platforms" results are never ranked against another platform. A part uses its age bucket when that bucket has ≥ 20 values for the platform, otherwise the platform's whole result set (V\* is already age-adjusted). Percentile rank = (values below + half the ties) / (n − 1), so the best is 1 and the worst 0. Scores are recomputed after Load more.
- **Fallback (< 20 values for a part).** A fixed scale with the v1 shape: speed $= \min(14\log_{10}(\text{views/h}+1), 70)/70$ and engagement $= \min(\tilde E, 0.2)/0.2$, combined with the same weights. Shrunk engagement is used here too, so small videos can't max it out.
- **Unknown post date.** The speed part counts as the median (0.5) instead of being dropped, so a missing date neither adds nor removes points (a date-less video with no likes scores exactly 50), and confidence is *Low*. Dropping it entirely would let engagement alone decide the score.
- **Missing likes.** The engagement part is dropped and the weights renormalized, so a YouTube result scores its speed percentile. A reported 0% engagement is real data and ranks last on engagement.
- **Confidence.** *Low* when the date or engagement is missing or views < 1,000; *Medium* when speed and engagement are present; *High* needs the outlier component (not built).
- Shown on each card's breakdown with the points from each part. `video_open` events carry `score_version` (`1.1a`) and `confidence` for the validation in §4.5.

### 4.5 Validation and tuning

1. **Ground-truth dataset.** Each week, sample about 300 result videos, stratified by platform and age bucket. Re-fetch their view counts at +24 h and +72 h. This costs about 600 credits per week.
2. **Label.** $g = \log(\text{views}_{t+72h}/\text{views}_t)$. Also define a binary "breakout" label: $g$ is in the platform's top decile.
3. **Offline metrics.**
   - Spearman ρ between $S$ and $g$.
   - Precision@10 and NDCG@10 per result set.
   - Per-platform score distributions: compare medians and use a KS test. The target is a median of about 50 on every platform.
4. **Tuning.** Grid-search $\beta \in [0.4, 1.0]$, $k \in \{1\text{k}, 5\text{k}, 20\text{k}\}$ and the weights $w$, choosing on ρ and NDCG with a time-based holdout. Ship only if v1.1 beats v1 on both ρ and P@10 on every platform.
5. **Online.** Run an A/B test, bucketing by random session ID. The primary metric is the click-through rate on top-5 cards. Guardrails are search latency and credits per session.

### 4.6 Product analytics events

**Privacy rules:**
- No accounts, cookies, IP storage or fingerprinting. Use a random `session_id` in `sessionStorage` that resets each tab session.
- Respect DNT/GPC by sending nothing when either is set.
- Do not log the raw query by default. Log `query_len`, `query_words`, and a daily-salted SHA-256 `query_hash`, which allows deduplication within a day only.
- Video IDs are public content and may be logged.
- Retain events for 90 days.
- Send events to a Netlify function or a cookieless analytics tool.

| Event | Properties |
|---|---|
| `search_submitted` | platform, range, query_len, query_words, query_hash, from_shared_link (bool) |
| `search_completed` | platform, range, result_count, deduped_count, latency_ms, credits_used, page_index, pct_null_engagement, pct_null_date |
| `search_failed` | platform, error_class (`no_key`, `upstream_4xx`, `upstream_5xx`, `timeout`, `validation`), latency_ms |
| `load_more_clicked` | platform, page_index, results_so_far |
| `sort_changed` | from_key, to_key, result_count |
| `min_views_changed` | value, hidden_count |
| `video_opened` | platform, video_id, rank_position, sort_key, score, score_version, confidence, velocity_bucket, age_bucket |
| `deep_score_requested` (v1.1) | platform, videos_enriched, credits_used, cache_hit_rate |
| `score_snapshot` (server, sampled) | platform, video_id, views, likes, comments, shares, age_h, score_version, score |

`score_snapshot` feeds the reference quantile tables (§4.4, step 3) and the validation set (§4.5). `video_opened.rank_position` together with `score` supplies the online relevance signal.


---

## 5. Security, Privacy & Compliance (Security & Compliance Lead)

### 5.1 Scope and audit summary

Reviewed: `netlify/functions/search.mjs`, `public/app.js`, `public/index.html`, `netlify.toml`, `package.json`, `.gitignore`, `.env.example`.

What the code does well today:
- The ScrapeCreators key is read only from `process.env.SCRAPECREATORS_API_KEY` on the server. It is never sent to the browser.
- `.gitignore` excludes `.env`, `.netlify/` and `node_modules/`. `.env.example` holds only a placeholder. The only tracked file in git history so far is `README.md`.
- All upstream text (titles, authors, handles) is rendered with `textContent`. Nothing uses `innerHTML`. Outbound links use `rel="noopener noreferrer"`, and thumbnails load with `referrerPolicy="no-referrer"`.
- `platform` is checked against an allowlist. Upstream query strings are built with `URLSearchParams.set`, so a caller cannot inject extra parameters or change the path. `q` is limited to 200 characters.

Gaps found:
1. `/api/search` is an **open, unauthenticated proxy to a paid API**. It has no rate limit, no origin check and no spend cap. Every request that misses the cache costs 1 credit. Requests with `cursor` set ("Load more") cost 1 credit each.
2. The response returns `credits` (`credits_remaining`) to every caller. This shows an attacker how much balance is left and whether their draining is working.
3. Upstream error text goes straight to the client (`Search failed: ${err.message}`).
4. `v.url` from YouTube results is placed in `href` without a scheme check. A `javascript:` URL from upstream would run when clicked.
5. The `range` check uses `in`, which also matches inherited keys such as `constructor` and `toString`. These pass the check and send junk to the upstream API, which still costs credits. Use `Object.hasOwn`.
6. `cursor` is passed through with no length or format check.
7. There are no security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`).
8. Opening a shared link (`?q=...`) runs a search automatically. Any page can embed or link to such URLs and make visitors spend credits.

### 5.2 Threat model

| # | Threat | Impact | Likelihood | Current mitigation | Required mitigation | Priority |
|---|---|---|---|---|---|---|
| T1 | **API key leaks** (committed `.env`, key in logs, key pasted into an issue, key in a client bundle) | Full use of the paid account by others, credits drained, possible account suspension | Medium (public repo, bots scan GitHub within minutes) | Key only in env var; `.env` gitignored | Enable GitHub secret scanning and push protection; add a pre-commit secret scan (gitleaks); never log request headers; document a rotation runbook | **P0** |
| T2 | **Credit draining through the open proxy** (scripted loops, cursor paging, cross-site requests, auto-search links) | Direct money loss; the service stops working when credits run out | **High** (open endpoint on a paid API is a known target) | 200-character limit on `q`; 5-minute `cache-control` | Rate limit per IP; global daily credit budget with a kill switch; server-side cache; origin/`Sec-Fetch-Site` check; stop returning `credits` to clients; cap pages per query | **P0** |
| T3 | **XSS through video titles, authors or thumbnails** | Session or page takeover, malicious redirects | Low for text (uses `textContent`); Medium for `href` (unvalidated `v.url`) | `textContent` everywhere; `noopener` | Server: allow only `https:` URLs on the `tiktok.com`, `youtube.com` and `youtu.be` hosts for `url`, and only `https:` for `thumbnail`. Strict CSP: `default-src 'self'; img-src 'self' https:; script-src 'self'; object-src 'none'; frame-ancestors 'none'` | **P0** (URL check), P1 (CSP) |
| T4 | **Upstream errors leak details** (provider messages, quota state, internal paths) | Information disclosure that helps attackers | Medium | None (message forwarded as is) | Map errors to generic user messages ("Search is temporarily unavailable"); log details server-side only, without the key | **P1** |
| T5 | **SSRF / parameter injection** | Upstream misuse, wasted credits | Low (fixed host, `searchParams.set`) | Fixed base URL; platform allowlist | Use `Object.hasOwn` for `range`; limit `cursor` to ≤512 characters with a restricted character set; trim and normalize `q`; reject unknown parameters | **P1** |
| T6 | **Dependency / supply chain** | Malicious code in the build or function | Low today (no runtime deps) | `package.json` has no dependencies | Commit a lockfile once deps are added; Dependabot alerts; pin the Node version; no third-party scripts or CDNs on the frontend; review the `netlify-cli` version | **P2** |
| T7 | **Clickjacking / content-type sniffing** | UI redress | Low | None | `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` set through `netlify.toml` `[[headers]]` | **P1** |
| T8 | **Abuse by search content** (searches for illegal or harmful terms, results showing harmful media) | Reputational and legal exposure | Medium | None | Basic keyword denylist (CSAM-related terms at minimum); report link in footer; rely on platform moderation and state this in the ToS | **P1** |

### 5.3 Secrets management requirements

- **S1 (P0):** `SCRAPECREATORS_API_KEY` exists only in Netlify environment variables, scoped to **Functions** and marked secret. It is never set in `netlify.toml`, `public/` or the build environment.
- **S2 (P0):** Before the repo goes public, enable GitHub secret scanning and push protection, and run `gitleaks detect` over the full history. Current history (one commit, `README.md` only) is clean.
- **S3 (P0):** Use separate keys for local development and production. If ScrapeCreators supports it, set a per-key spend or credit alert.
- **S4 (P1):** Rotation runbook: revoke the key in the ScrapeCreators dashboard, update it in Netlify, trigger a redeploy, then check the credit balance. Rotate immediately if a leak is suspected, and at least every 6 months otherwise.
- **S5 (P1):** Function logs must never contain the key or full upstream request headers. Log only the query hash, platform, status and latency.

### 5.4 Rate limiting and cost controls

Concrete options on Netlify, from cheapest to strongest:

1. **Netlify rate limiting (P0):** Netlify Functions support a `rateLimit` field in the function `config` export (`windowLimit`, `windowSize`, `aggregateBy: ["ip", "domain"]`). It can also be set as a rule in Site configuration, depending on plan. Starting value: **20 requests/minute per IP**. Requests over the limit get HTTP 429 and cost no credits.
2. **Edge caching (P0):** Send `Netlify-CDN-Cache-Control: public, s-maxage=900, stale-while-revalidate=3600` and `Netlify-Vary: query=q|platform|range|cursor` so identical searches are served from the CDN at no credit cost. Lowercase and trim `q` on the client and the server so more requests hit the cache.
3. **Global daily budget / kill switch (P0):** Keep a credit counter per UTC day in **Netlify Blobs** and increment it on every upstream call. Above a configured `DAILY_CREDIT_CAP` (env var, e.g. 500), return 503 "Daily limit reached". Add an env flag `SEARCH_DISABLED=true` for an instant shutoff without a redeploy.
4. **Origin checks (P1):** Reject requests whose `Sec-Fetch-Site` is `cross-site`, or whose `Origin`/`Referer` is set to a host other than the production domain. This stops drive-by credit use from other sites. It does not stop scripted clients.
5. **Bot friction (P1, if abuse appears):** Cloudflare Turnstile (invisible) checked server-side before the first page of a search, or a signed short-lived token issued with the page.
6. **Pagination cap (P1):** At most 5 pages per query per client session. Remove the auto-submit on shared links, or require a click to confirm (P2).
7. **Monitoring (P1):** Alert by email or webhook when the daily counter passes 50% and 80% of the cap, and when the upstream returns low-balance errors. Remove `credits` from the public response and log it server-side instead.

### 5.5 Privacy and data retention

- The app has no accounts, cookies or analytics, and stores no user data. Keep it this way for v1, which keeps GDPR/CCPA exposure low.
- **Search queries count as user data.** They can reveal interests and are sent to ScrapeCreators. Netlify function logs keep IPs and URLs (including `q`) for the plan's log retention period. Requirement (P1): do not log raw `q` together with the IP; use a hash or truncated value. Document Netlify's log retention.
- Shareable URLs contain the query. This is acceptable, and should be mentioned in the privacy notice.
- Thumbnails load directly from TikTok and YouTube CDNs, so those platforms receive the visitor's IP (`no-referrer` already limits Referer leakage). State this in the privacy notice. Proxying images is an option, but it adds cost and copyright exposure.
- Publish a short **Privacy Notice** (P0 before launch) that covers: what is processed (query, IP, user agent), processors (Netlify, ScrapeCreators, and TikTok/YouTube for images), retention, no sale or sharing, and a contact email. If analytics are added later, use a cookieless tool, or add consent for EU visitors.
- Creator data shown (names, handles, public counts) is public profile data. Do not store or aggregate it beyond the 15-minute cache. Do not build creator profiles.

### 5.6 Third-party terms and legal considerations (flag for review; not legal advice)

| Area | Issue to review | Owner action |
|---|---|---|
| **ScrapeCreators ToS** | Does the plan allow public, resale-like exposure of results through an open endpoint? Are there limits on caching or redistributing results, or attribution requirements? | Read the ToS and confirm in writing if unclear |
| **TikTok ToS** | TikTok's terms forbid automated collection and scraping of its service. Viral Finder uses data obtained by a third-party scraper, so some risk passes to us (takedown or cease-and-desist). | Counsel review; consider the TikTok Research/Display APIs as an alternative |
| **YouTube ToS / API policies** | Scraped data is not covered by the YouTube API Services Terms. If the official Data API is adopted, its policies apply (data refresh, branding, privacy policy link). | Review; evaluate the YouTube Data API v3 for the YouTube tabs |
| **Thumbnails (copyright)** | Thumbnails are hotlinked from platform CDNs, not copied. Hotlinking is generally lower risk, but thumbnails are still copyrighted works. | Keep hotlinking; never cache or re-host images; add DMCA/takedown contact |
| **Embedding / linking** | Linking to original videos is low risk. Embedding players must use the official embed players only. | No custom players or downloads; no "download video" feature |
| **Attribution / trademarks** | The footer already says "Not affiliated with TikTok or YouTube". Do not use platform logos beyond nominative text labels. | Keep the disclaimer; review the branding guidelines |
| **Harmful content / minors** | Results may include content involving minors or harmful material. | Add a report link and keyword denylist; publish Terms of Use with a disclaimer |

Residual risk: even with every control above, the core data source (scraping) remains a legal and continuity risk that only counsel review or a move to official APIs can reduce.

### 5.7 Pre-launch compliance checklist

- [ ] **P0** `gitleaks` scan of full history is clean; GitHub secret scanning and push protection are on
- [ ] **P0** Key exists only in Netlify env (Functions scope); production and dev keys are separate
- [ ] **P0** Per-IP rate limit is active (verified by load test: request 21 within a minute returns 429)
- [x] **P0** Daily credit cap and `SEARCH_DISABLED` kill switch are implemented and tested
- [ ] **P0** CDN cache headers are verified (a repeat query is served with no upstream call)
- [ ] **P0** `url`/`thumbnail` scheme and host allowlist is enforced server-side
- [ ] **P0** `credits` removed from the public response
- [ ] **P0** Privacy Notice and Terms of Use are published and linked in the footer
- [x] **P1** Generic error messages; upstream details only in server logs
- [x] **P1** `Object.hasOwn` check for `range`; `cursor` length and charset check
- [ ] **P1** Security headers (CSP, nosniff, frame-ancestors, Referrer-Policy) set in `netlify.toml`
- [ ] **P1** Spend alerts at 50% and 80% of the cap
- [ ] **P1** ScrapeCreators, TikTok and YouTube terms reviewed by counsel; decision recorded
- [ ] **P1** Takedown/DMCA and abuse-report contact published
- [ ] **P2** Dependabot enabled; lockfile committed when dependencies are added
- [x] **P2** Auto-search on shared links requires a click


---

