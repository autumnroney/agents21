// Metrics, viral score and formatting helpers. An ES module so the browser
// (app.js) and the Node tests (tests/) share the same code.

// ---------- metrics ----------

export function hoursSince(iso, now = Date.now()) {
  if (!iso) return null;
  const h = (now - new Date(iso).getTime()) / 36e5;
  return Number.isFinite(h) ? Math.max(h, 1) : null;
}

export function engagementRate(v) {
  if (!v.views || v.likes == null) return null;
  return ((v.likes || 0) + (v.comments || 0) + (v.shares || 0)) / v.views;
}

// ---------- viral score v1 (MVP) ----------

// The original formula (PRD §4.2), kept so the tests can reproduce the PRD
// §4.3 worked examples and compare it with the current model.
export function scoreV1(v) {
  const velocity = v.velocity ?? (v.views || 0) / 720; // unknown age: assume ~30 days
  const speed = 14 * Math.log10(velocity + 1);
  const eng = v.engagement != null ? 150 * Math.min(v.engagement, 0.2) : 10;
  return Math.max(0, Math.min(100, Math.round(speed + eng)));
}

// ---------- viral score v1.1a (PRD §4.4) ----------
//
// 1. Age-adjusted velocity  V* = views / (h + 2)^0.6   (unknown age: missing)
// 2. Shrunk engagement      Ẽ = (likes + 2·comments + 3·shares + k·μp) / (views + k)
// 3. Each part becomes a percentile within its platform (and age bucket) in
//    the current result set; with fewer than 20 values a fixed scale is used.
// 4. S = 100 · Σ w·P / Σ w over the parts that are available.
// No extra API calls, so the follower-relative "outlier" part is never available.

export const SCORE_VERSION = "1.1a";
export const H0 = 2;
export const BETA = 0.6;
export const PRIOR_K = 5000;
export const PRIOR_ENGAGEMENT = { tiktok: 0.1, youtube: 0.03, "youtube-shorts": 0.03 };
export const WEIGHTS = { velocity: 0.6, engagement: 0.25, outlier: 0.15 };
export const MIN_REFERENCE = 20;
// Unknown post date: the speed part counts as the median, so it neither adds nor removes points.
const NEUTRAL = 0.5;

// Hours since posting, unclamped (the h0 term handles brand-new posts).
export function ageHours(iso, now = Date.now()) {
  if (!iso) return null;
  const h = (now - new Date(iso).getTime()) / 36e5;
  return Number.isFinite(h) ? Math.max(h, 0) : null;
}

export function adjustedVelocity(views, hours) {
  if (views == null || hours == null) return null;
  return views / (hours + H0) ** BETA;
}

export function smoothedEngagement(v) {
  if (v.views == null || v.likes == null) return null;
  const mu = PRIOR_ENGAGEMENT[v.platform] ?? 0.05;
  const interactions = (v.likes || 0) + 2 * (v.comments || 0) + 3 * (v.shares || 0);
  return (interactions + PRIOR_K * mu) / (v.views + PRIOR_K);
}

export function ageBucket(hours) {
  if (hours == null) return null;
  if (hours < 24) return "day";
  if (hours < 24 * 7) return "week";
  if (hours < 24 * 30) return "month";
  return "older";
}

// Share of the reference values below `value` (ties count half), scaled so the
// lowest value is 0 and the highest is 1. `ref` includes the value itself.
export function percentileRank(value, ref) {
  if (ref.length < 2) return NEUTRAL;
  let below = 0;
  let equal = 0;
  for (const x of ref) {
    if (x < value) below++;
    else if (x === value) equal++;
  }
  return (below + Math.max(equal - 1, 0) / 2) / (ref.length - 1);
}

// Fixed scales, used when there are too few results to compare against.
// Same shape as v1: speed reaches the top at ~100k views/hr, engagement at 20%.
export function fixedSpeed(velocity) {
  return Math.min(14 * Math.log10(velocity + 1), 70) / 70;
}

export function fixedEngagement(e) {
  return Math.min(Math.max(e, 0), 0.2) / 0.2;
}

// Picks the reference for one part: same platform and age bucket when that
// bucket has enough values, else the whole platform, else the fixed scale.
function rank(value, bucket, byBucket, all, fixed) {
  const inBucket = bucket ? byBucket.get(bucket) : null;
  if (inBucket && inBucket.length >= MIN_REFERENCE) return { pct: percentileRank(value, inBucket), source: "bucket", n: inBucket.length };
  if (all.length >= MIN_REFERENCE) return { pct: percentileRank(value, all), source: "platform", n: all.length };
  return { pct: fixed(), source: "fixed", n: all.length };
}

function references(list, key) {
  const all = [];
  const byBucket = new Map();
  for (const v of list) {
    if (v[key] == null) continue;
    all.push(v[key]);
    const b = ageBucket(v.ageHours);
    if (b) byBucket.set(b, [...(byBucket.get(b) || []), v[key]]);
  }
  return { all, byBucket };
}

export function confidence(v, parts) {
  if (parts.speed.source === "unknown" || !parts.eng || (v.views ?? 0) < 1000) return "low";
  return parts.outlier ? "high" : "medium";
}

// Scores every video in the list, in place, against the others from the same
// platform. Call it again whenever the list changes (e.g. after Load more).
export function scoreAll(list) {
  const byPlatform = new Map();
  for (const v of list) byPlatform.set(v.platform, [...(byPlatform.get(v.platform) || []), v]);

  for (const group of byPlatform.values()) {
    const vel = references(group, "adjVelocity");
    const eng = references(group, "smoothEngagement");
    for (const v of group) {
      const bucket = ageBucket(v.ageHours);
      const speed = v.adjVelocity == null
        ? { pct: NEUTRAL, source: "unknown", n: vel.all.length }
        : rank(v.adjVelocity, bucket, vel.byBucket, vel.all, () => fixedSpeed(v.velocity ?? 0));
      const engPart = v.smoothEngagement == null
        ? null
        : rank(v.smoothEngagement, bucket, eng.byBucket, eng.all, () => fixedEngagement(v.smoothEngagement));

      const wsum = WEIGHTS.velocity + (engPart ? WEIGHTS.engagement : 0);
      speed.points = (100 * WEIGHTS.velocity * speed.pct) / wsum;
      if (engPart) engPart.points = (100 * WEIGHTS.engagement * engPart.pct) / wsum;
      const parts = { speed, eng: engPart, outlier: null };
      v.score = Math.max(0, Math.min(100, Math.round(speed.points + (engPart?.points ?? 0))));
      v.scoreInfo = { version: SCORE_VERSION, ...parts, score: v.score, confidence: confidence(v, parts) };
    }
  }
  return list;
}

// Adds the per-video metrics. Scores need the whole list: see scoreAll.
export function enrich(v, now = Date.now()) {
  const hours = hoursSince(v.publishedAt, now);
  v.velocity = hours && v.views != null ? v.views / hours : null;
  v.engagement = engagementRate(v);
  v.ageHours = ageHours(v.publishedAt, now);
  v.adjVelocity = adjustedVelocity(v.views, v.ageHours);
  v.smoothEngagement = smoothedEngagement(v);
  return v;
}

// ---------- formatting ----------

export function compact(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(x) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

export function ago(iso, now = Date.now()) {
  const h = hoursSince(iso, now);
  if (h == null) return "—";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function duration(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------- query helpers ----------

// Same normalization as the server, so equal searches share one cache entry.
export function normalizeQuery(q) {
  return (q || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Analytics never sees the query, only how long it was.
export function queryLengthBucket(q) {
  const n = (q || "").length;
  if (n <= 10) return "1-10";
  if (n <= 20) return "11-20";
  if (n <= 50) return "21-50";
  return "51+";
}

// Maps a failed /api/search response to a typed error code.
export function errorCode(status, data) {
  if (data && typeof data.code === "string") return data.code;
  if (status === 429) return "rate_limited"; // Netlify's own rate limiter
  if (status === 504) return "timeout";
  return "unknown";
}
