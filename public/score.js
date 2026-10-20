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

// Viral score (0-100): mostly how fast views are coming in (log scale),
// plus a bonus for strong engagement when the platform reports it.
// Returns the parts too, so the card can explain the number.
export function scoreParts(v) {
  const ageKnown = v.velocity != null;
  const velocity = v.velocity ?? (v.views || 0) / 720; // unknown age: assume ~30 days
  const speed = 14 * Math.log10(velocity + 1);
  const engKnown = v.engagement != null;
  const eng = engKnown ? 150 * Math.min(v.engagement, 0.2) : 10;
  const score = Math.max(0, Math.min(100, Math.round(speed + eng)));
  return { speed: Math.round(speed), eng: Math.round(eng), score, ageKnown, engKnown, capped: speed + eng > 100 };
}

export function viralScore(v) {
  return scoreParts(v).score;
}

export function enrich(v, now = Date.now()) {
  const hours = hoursSince(v.publishedAt, now);
  v.velocity = hours && v.views != null ? v.views / hours : null;
  v.engagement = engagementRate(v);
  v.score = viralScore(v);
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
