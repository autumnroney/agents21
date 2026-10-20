# 🔥 Viral Finder

Find viral TikTok, YouTube Shorts and YouTube videos on any topic, ranked by how fast they're blowing up.

- Search by keyword, platform and time range (24h, week, month, 3 months, all time)
- Each video gets a **viral score (0–100)** based on views per hour and engagement rate
- Sort by viral score, views/hour, total views, engagement or newest; filter by minimum views
- "Load more" pagination; shareable search links (`?q=gym+tips&platform=tiktok&range=week`)

Data comes from the [ScrapeCreators API](https://docs.scrapecreators.com/). The API key stays on the server inside a Netlify Function, so it never reaches the browser or your GitHub repo.

## Project layout

```
public/                    Static site (HTML/CSS/JS, no build step)
netlify/functions/search.mjs  /api/search -> ScrapeCreators proxy
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
4. Trigger a redeploy (**Deploys → Trigger deploy**) so the function picks up the key.

> Do not commit the API key. `.env` is git-ignored for local use.

## Run locally

```bash
npm install -g netlify-cli
cp .env.example .env   # then put your key in .env
netlify dev            # http://localhost:8888
```

## Credits

Each search or "Load more" click costs 1 ScrapeCreators credit. Responses are cached for 5 minutes.
