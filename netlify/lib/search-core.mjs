// Core of /api/search: proxies searches to the ScrapeCreators API so the API
// key stays on the server, and returns a normalized list of videos.
// Lives outside netlify/functions/ so tests can build a handler with an
// in-memory usage store (see createSearchHandler).

import { DEFAULT_DAILY_CREDIT_CAP, intEnv, reserveCredits, usageStore } from "./daily-cap.mjs";

const API = "https://api.scrapecreators.com";
const UPSTREAM_TIMEOUT_MS = 8000; // Netlify cuts synchronous functions off at 10 s.

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

const PLATFORMS = ["tiktok", "shorts", "youtube"];

// Every error carries a typed `code`; the message is ours, never upstream text.
const ERRORS = {
  bad_request: { status: 400, message: "Invalid search." },
  rate_limited: { status: 429, message: "Too many searches. Wait a minute and try again." },
  out_of_credits: { status: 503, message: "Daily search limit reached. Try again later." },
  daily_limit: { status: 503, message: "Daily search limit reached. Try again later." },
  disabled: { status: 503, message: "Search is paused for maintenance. Please check back later." },
  upstream_error: { status: 502, message: "Search is temporarily unavailable. Try again in a moment." },
  timeout: { status: 504, message: "The search took too long. Try again." },
  config: { status: 500, message: "Search is temporarily unavailable. We're on it." },
};

export class SearchError extends Error {
  constructor(code, detail, { retryAfter } = {}) {
    super(detail || code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function errorResponse(code, message, headers = {}) {
  const e = ERRORS[code] || ERRORS.upstream_error;
  return Response.json(
    { error: message || e.message, code: ERRORS[code] ? code : "upstream_error" },
    { status: e.status, headers: { "cache-control": "no-store", ...headers } },
  );
}

// Lowercase, trim and collapse whitespace so "Cats " and "cats" share a cache entry.
export function normalizeQuery(q) {
  return (q || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Maps a failed upstream response to one of our error codes.
export function classifyUpstream(status, message = "") {
  if (status === 401 || status === 403) return "config";
  if (status === 402 || /credit/i.test(message)) return "out_of_credits";
  if (status === 429) return "rate_limited";
  return "upstream_error";
}

async function callApi(path, params, ctx) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url, { headers: { "x-api-key": ctx.key }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SearchError("timeout", "upstream timeout");
    throw new SearchError("upstream_error", `network: ${err?.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (typeof body.credits_remaining === "number") ctx.onCredits(body.credits_remaining);
  if (!res.ok || body.success === false) {
    const msg = String(body.message || body.error || `HTTP ${res.status}`);
    throw new SearchError(classifyUpstream(res.status, msg), `upstream ${res.status}: ${msg.slice(0, 200)}`, {
      retryAfter: res.headers.get("retry-after") || undefined,
    });
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

export function normalizeTikTok(item) {
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

export function normalizeYouTube(v) {
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

async function searchTikTok(q, range, cursor, ctx) {
  const data = await callApi(
    "/v1/tiktok/search/keyword",
    { query: q, date_posted: TIKTOK_DATE[range], sort_by: "relevance", cursor, trim: "true" },
    ctx,
  );
  const items = (data.search_item_list || []).map(normalizeTikTok).filter(Boolean);
  return { items, cursor: data.cursor ?? null };
}

async function searchYouTube(q, range, type, cursor, ctx) {
  const data = await callApi(
    "/v1/youtube/search",
    {
      query: q,
      uploadDate: YOUTUBE_DATE[range],
      sortBy: "popular",
      type,
      continuationToken: cursor,
    },
    ctx,
  );
  const raw = [...(data.videos || []), ...(data.shorts || [])];
  for (const shelf of data.shelves || []) raw.push(...(shelf.items || []));
  let items = raw.map(normalizeYouTube).filter(Boolean);
  // YouTube has no "last 3 months" filter, so we fetch "this year" and trim.
  if (range === "3months") {
    const cutoff = Date.now() - 90 * 864e5;
    items = items.filter((v) => !v.publishedAt || new Date(v.publishedAt).getTime() >= cutoff);
  }
  return { items, cursor: data.continuationToken ?? null };
}

function searchOne(platform, q, range, cursor, ctx) {
  if (platform === "tiktok") return searchTikTok(q, range, cursor, ctx);
  if (platform === "youtube") return searchYouTube(q, range, "videos", cursor, ctx);
  return searchYouTube(q, range, "shorts", cursor, ctx);
}

// "All platforms" pages with one cursor per platform, packed into one opaque string.
export function encodeAllCursor(cursors) {
  const live = Object.fromEntries(Object.entries(cursors).filter(([, c]) => c != null));
  return Object.keys(live).length ? Buffer.from(JSON.stringify(live)).toString("base64url") : null;
}

export function decodeAllCursor(cursor) {
  try {
    const obj = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out = {};
    for (const p of PLATFORMS) {
      if (obj[p] == null) continue;
      if (typeof obj[p] !== "string" && typeof obj[p] !== "number") return null;
      out[p] = String(obj[p]);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// Queries several platforms at once. Platforms that fail are dropped; if all
// fail, the first error is thrown.
async function searchAll(q, range, cursors, ctx) {
  const platforms = Object.keys(cursors);
  const settled = await Promise.allSettled(platforms.map((p) => searchOne(p, q, range, cursors[p], ctx)));
  const items = [];
  const next = {};
  let firstError = null;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value.items);
      next[platforms[i]] = r.value.cursor;
    } else {
      firstError ??= r.reason;
      console.error(JSON.stringify({ fn: "search", msg: "platform failed in all mode", platform: platforms[i], code: r.reason?.code, detail: r.reason?.message }));
    }
  });
  if (firstError && settled.every((r) => r.status === "rejected")) throw firstError;
  return { items, cursor: encodeAllCursor(next) };
}

// Builds the request handler. `getUsageStore` is injectable for tests.
export function createSearchHandler({ getUsageStore = usageStore } = {}) {
  // Counts upstream calls for today; fails open if Blobs is unavailable.
  async function checkDailyCap(cost) {
    const cap = intEnv(process.env.DAILY_CREDIT_CAP, DEFAULT_DAILY_CREDIT_CAP);
    try {
      return await reserveCredits(getUsageStore(), { cap, cost });
    } catch (err) {
      console.error(JSON.stringify({ fn: "search", msg: "daily cap skipped: Netlify Blobs unavailable", detail: err?.message }));
      return { allowed: true, used: null };
    }
  }

  return async (req) => {
    const started = Date.now();
    const log = { fn: "search" };
    const finish = (res, extra = {}) => {
      Object.assign(log, extra, { status: res.status, ms: Date.now() - started });
      console.log(JSON.stringify(log));
      return res;
    };

    // Kill switch: instant shutoff without a redeploy.
    if (process.env.SEARCH_DISABLED === "true") return finish(errorResponse("disabled"), { code: "disabled" });

    const key = process.env.SCRAPECREATORS_API_KEY;
    if (!key) {
      console.error("SCRAPECREATORS_API_KEY is not set (Netlify > Site configuration > Environment variables).");
      return finish(errorResponse("config"), { code: "config" });
    }

    const params = new URL(req.url).searchParams;
    const q = normalizeQuery(params.get("q"));
    const platform = params.get("platform") || "tiktok";
    const range = Object.hasOwn(TIKTOK_DATE, params.get("range")) ? params.get("range") : "week";
    const cursor = params.get("cursor") || undefined;
    Object.assign(log, { platform, range, q_len: q.length, page: cursor ? "next" : "first" });

    const bad = (message) => finish(errorResponse("bad_request", message), { code: "bad_request" });
    if (!q) return bad("Enter a search term.");
    if (q.length > 200) return bad("Search term is too long.");
    if (platform !== "all" && !PLATFORMS.includes(platform)) return bad("Unknown platform.");
    if (cursor && (cursor.length > 2048 || !/^[\w\-=%.+/]+$/.test(cursor))) return bad("Invalid page cursor.");

    let allCursors = null;
    if (platform === "all") {
      allCursors = cursor ? decodeAllCursor(cursor) : Object.fromEntries(PLATFORMS.map((p) => [p, undefined]));
      if (!allCursors) return bad("Invalid page cursor.");
    }

    // One credit per upstream call: "all" costs one per platform queried.
    const cost = allCursors ? Object.keys(allCursors).length : 1;
    const budget = await checkDailyCap(cost);
    log.daily_used = budget.used;
    if (!budget.allowed) return finish(errorResponse("daily_limit"), { code: "daily_limit" });

    const alertAt = intEnv(process.env.CREDITS_ALERT_THRESHOLD, 1000);
    const ctx = {
      key,
      onCredits(n) {
        log.credits_remaining = n; // server logs only, never the response
        if (n < alertAt) console.warn(JSON.stringify({ fn: "search", msg: "ScrapeCreators credits low", credits_remaining: n, threshold: alertAt }));
      },
    };

    try {
      const result = allCursors
        ? await searchAll(q, range, allCursors, ctx)
        : await searchOne(platform, q, range, cursor, ctx);

      // De-duplicate (TikTok search can repeat results).
      const seen = new Set();
      result.items = result.items.filter((v) => !seen.has(v.id) && seen.add(v.id));
      // Cache identical searches for 5 minutes (browser + Netlify CDN) to save credits.
      return finish(
        Response.json(result, {
          headers: {
            "cache-control": "public, max-age=300",
            "netlify-cdn-cache-control": "public, max-age=300, durable",
            "netlify-vary": "query=q|platform|range|cursor",
          },
        }),
        { items: result.items.length },
      );
    } catch (err) {
      const code = err instanceof SearchError ? err.code : "upstream_error";
      console.error(JSON.stringify({ fn: "search", msg: "search failed", code, detail: err?.message }));
      const headers = code === "rate_limited" && err.retryAfter ? { "retry-after": err.retryAfter } : {};
      return finish(errorResponse(code, undefined, headers), { code });
    }
  };
}
