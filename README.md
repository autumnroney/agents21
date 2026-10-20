# 🔥 Viral Finder

Find viral TikTok, YouTube Shorts and YouTube videos on any topic, ranked by how fast they're blowing up.

- Search by keyword, platform (TikTok, YT Shorts, YouTube, or **All** merged into one ranked list) and time range (24h, week, month, 3 months, all time)
- Each video gets a **viral score (0–100)**: age-adjusted views per hour and engagement, ranked against the other results from the same platform (50 = typical, 100 = best), with a confidence level. See PRD §4.4
- Sort by viral score, views/hour, total views, engagement or newest; filter by minimum views
- Tap a card's score to see how it was calculated; the "i" button explains the formula
- **Export CSV** and **Copy results** for the results on screen (after sort and min views). Both run in the browser and cost no credits; CSV cells are escaped and protected against spreadsheet formula injection
- "Load more" pagination; shareable search links with sort and filters (`?q=gym+tips&platform=tiktok&range=week&sort=views&minViews=10000`) and a "Copy link" button. Opening a shared link fills the form; the visitor presses Search, so links can't spend credits on their own
- Cost controls: per-IP rate limit, a global daily credit cap, a kill switch, and a low-credit log warning
- Privacy-friendly analytics: no cookies, no IP or user agent stored, no query text (see `public/privacy.html`)

Data comes from the [ScrapeCreators API](https://docs.scrapecreators.com/). The API key stays on the server inside a Netlify Function, so it never reaches the browser or your GitHub repo.

## Project layout

```
public/                    Static site (HTML/CSS/JS ES modules, no build step)
public/score.js            Viral score (v1.1a) and formatting helpers (shared with tests)
public/export.js           CSV export and plain-text copy (shared with tests)
public/privacy.html        Privacy Notice
netlify/functions/search.mjs  /api/search -> ScrapeCreators proxy
netlify/functions/event.mjs   /api/event -> privacy-friendly analytics log
netlify/lib/               Function logic (search, daily cap, events)
tests/                     `npm test` (node --test, no network)
netlify.toml               Netlify config
docs/PRD.md                Product Requirements Document
.claude/agents/            The 5 expert agents that wrote the PRD
```

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project →** pick the repo. Build settings come from `netlify.toml` (no build command needed).
3. Go to **Site configuration → Environment variables** and add:
   - Key: `SCRAPECREATORS_API_KEY`
   - Value: your ScrapeCreators API key
4. Optional settings (same place, scope **Functions**):

   | Variable | Default | What it does |
   |---|---|---|
   | `DAILY_CREDIT_CAP` | `500` | Max upstream calls per UTC day, counted in Netlify Blobs. Above it, search returns 503 `daily_limit`. "All platforms" counts 3. |
   | `CREDITS_ALERT_THRESHOLD` | `1000` | Logs a warning (`ScrapeCreators credits low`) in the function log when the balance drops below this. The balance is never sent to the browser. |
   | `SEARCH_DISABLED` | `false` | Set to `true` to turn search off instantly (503 `disabled`) without calling ScrapeCreators. |

5. Trigger a redeploy (**Deploys → Trigger deploy**) so the function picks up the variables.

The daily cap uses [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (store `usage`, one counter per UTC day); no setup is needed on Netlify. If Blobs is unavailable (for example plain local runs without `netlify dev`), the cap is skipped with a log line and search keeps working.

> Do not commit the API key. `.env` is git-ignored for local use.

## Run locally

```bash
npm install -g netlify-cli
cp .env.example .env   # then put your key in .env
npm install            # @netlify/blobs (Node 22.12+)
netlify dev            # http://localhost:8888
```

## Tests

```bash
npm test               # node --test; mocks fetch and Blobs, no network
```

## Credits

Each search or "Load more" click costs 1 ScrapeCreators credit ("All platforms" costs up to 3). Responses are cached for 5 minutes in the browser and on Netlify's CDN; the query is trimmed and lowercased so equal searches share a cache entry.

## Analytics

`/api/event` writes one JSON line per event to the function log (`{"type":"event", ...}`): `search`, `results_shown`, `load_more`, `video_open` (with score version and confidence), `copy_link`, `export_csv`, `copy_results` (result count only), `error`. Events carry platform, range, counts, timings, a query-length bucket and a random per-tab ID. No cookies, IP address, user agent or query text are stored, and nothing is sent when the browser has Do Not Track or Global Privacy Control on. Read them in **Logs → Functions → event**.

> Before launch, add a contact email to `public/privacy.html` (it has a placeholder).
