// Proxies searches to the ScrapeCreators API so the API key stays on the server.
// Returns a normalized list of videos from TikTok and/or YouTube.

const API = "https://api.scrapecreators.com";

const TIKTOK_DATE = {
  day: "yesterday",
  week: "this-week",
  month: "this-month",
  "3months": "last-3-months",
  all: "all-time",
};

const YOUTUBE_DATE = {
  day: "today",
  week: "this_week",
  month: "this_month",
  "3months": "this_year",
  all: undefined,
};

async function callApi(path, params, key) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { "x-api-key": key } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = body.message || body.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function firstUrl(obj) {
  return safeUrl(obj?.url_list?.[0]);
}

// Only pass through http(s) links so upstream data can't inject javascript: URLs.
function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : "";
}

function normalizeTikTok(item) {
  const a = item.aweme_info || item;
  if (!a?.aweme_id) return null;
  const s = a.statistics || {};
  const handle = a.author?.unique_id || "";
  return {
    platform: "tiktok",
    id: a.aweme_id,
    url: handle
      ? `https://www.tiktok.com/@${handle}/video/${a.aweme_id}`
      : `https://www.tiktok.com/video/${a.aweme_id}`,
    title: a.desc || "",
    thumbnail: firstUrl(a.video?.origin_cover) || firstUrl(a.video?.cover),
    author: a.author?.nickname || handle,
    handle,
    views: s.play_count ?? null,
    likes: s.digg_count ?? null,
    comments: s.comment_count ?? null,
    shares: s.share_count ?? null,
    publishedAt: a.create_time ? new Date(a.create_time * 1000).toISOString() : null,
    // aweme_info.duration is seconds; video.duration is milliseconds.
    durationSec: a.duration ?? (a.video?.duration ? Math.round(a.video.duration / 1000) : null),
  };
}

function normalizeYouTube(v) {
  if (!v?.id) return null;
  return {
    platform: v.type === "short" ? "youtube-shorts" : "youtube",
    id: v.id,
    url: safeUrl(v.url) || `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
    title: v.title || "",
    thumbnail: safeUrl(v.thumbnail),
    author: v.channel?.title || "",
    handle: v.channel?.handle || "",
    views: v.viewCountInt ?? null,
    likes: v.likeCountInt ?? null,
    comments: v.commentCountInt ?? null,
    shares: null,
    publishedAt: v.publishedTime || null,
    durationSec: v.lengthSeconds ?? null,
  };
}

async function searchTikTok(q, range, cursor, key) {
  const data = await callApi(
    "/v1/tiktok/search/keyword",
    { query: q, date_posted: TIKTOK_DATE[range], sort_by: "relevance", cursor, trim: "true" },
    key,
  );
  const items = (data.search_item_list || []).map(normalizeTikTok).filter(Boolean);
  return { items, cursor: data.cursor ?? null, credits: data.credits_remaining };
}

async function searchYouTube(q, range, type, cursor, key) {
  const data = await callApi(
    "/v1/youtube/search",
    {
      query: q,
      uploadDate: YOUTUBE_DATE[range],
      sortBy: "popular",
      type,
      continuationToken: cursor,
    },
    key,
  );
  const raw = [...(data.videos || []), ...(data.shorts || [])];
  for (const shelf of data.shelves || []) raw.push(...(shelf.items || []));
  const items = raw.map(normalizeYouTube).filter(Boolean);
  return { items, cursor: data.continuationToken ?? null, credits: data.credits_remaining };
}

export default async (req) => {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Server is missing SCRAPECREATORS_API_KEY. Add it in Netlify environment variables." },
      { status: 500 },
    );
  }

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") || "").trim();
  const platform = params.get("platform") || "tiktok";
  const range = params.get("range") in TIKTOK_DATE ? params.get("range") : "week";
  const cursor = params.get("cursor") || undefined;

  if (!q) return Response.json({ error: "Enter a search term." }, { status: 400 });
  if (q.length > 200) return Response.json({ error: "Search term is too long." }, { status: 400 });

  try {
    let result;
    if (platform === "tiktok") result = await searchTikTok(q, range, cursor, key);
    else if (platform === "youtube") result = await searchYouTube(q, range, "videos", cursor, key);
    else if (platform === "shorts") result = await searchYouTube(q, range, "shorts", cursor, key);
    else return Response.json({ error: "Unknown platform." }, { status: 400 });

    // De-duplicate (TikTok search can repeat results).
    const seen = new Set();
    result.items = result.items.filter((v) => !seen.has(v.id) && seen.add(v.id));
    // Cache identical searches for 5 minutes (browser + Netlify CDN) to save credits.
    return Response.json(result, {
      headers: {
        "cache-control": "public, max-age=300",
        "netlify-cdn-cache-control": "public, max-age=300, durable",
      },
    });
  } catch (err) {
    return Response.json({ error: `Search failed: ${err.message}` }, { status: 502 });
  }
};

export const config = { path: "/api/search" };
