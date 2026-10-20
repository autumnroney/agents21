"use strict";

const $ = (sel) => document.querySelector(sel);
const form = $("#search");
const results = $("#results");
const status = $("#status");
const moreBtn = $("#more");
const goBtn = $("#go");
const cardTpl = $("#card");

const PLATFORM_LABEL = { tiktok: "TikTok", youtube: "YouTube", "youtube-shorts": "Shorts" };

let state = { query: null, videos: [], cursor: null, loading: false };

// ---------- metrics ----------

function hoursSince(iso) {
  if (!iso) return null;
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  return Number.isFinite(h) ? Math.max(h, 1) : null;
}

function engagementRate(v) {
  if (!v.views || v.likes == null) return null;
  return ((v.likes || 0) + (v.comments || 0) + (v.shares || 0)) / v.views;
}

// Viral score (0-100): mostly how fast views are coming in (log scale),
// plus a bonus for strong engagement when the platform reports it.
function viralScore(v) {
  const velocity = v.velocity ?? (v.views || 0) / 720; // unknown age: assume ~30 days
  const speed = 14 * Math.log10(velocity + 1);
  const eng = v.engagement == null ? 10 : 150 * Math.min(v.engagement, 0.2);
  return Math.max(0, Math.min(100, Math.round(speed + eng)));
}

function enrich(v) {
  const hours = hoursSince(v.publishedAt);
  v.velocity = hours && v.views != null ? v.views / hours : null;
  v.engagement = engagementRate(v);
  v.score = viralScore(v);
  return v;
}

// ---------- formatting ----------

function compact(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function percent(x) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function ago(iso) {
  const h = hoursSince(iso);
  if (h == null) return "—";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

function duration(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------- rendering ----------

const SORTERS = {
  score: (a, b) => b.score - a.score,
  velocity: (a, b) => (b.velocity ?? -1) - (a.velocity ?? -1),
  views: (a, b) => (b.views ?? -1) - (a.views ?? -1),
  engagement: (a, b) => (b.engagement ?? -1) - (a.engagement ?? -1),
  newest: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
};

function render() {
  const minViews = Number($("#minViews").value);
  const list = state.videos
    .filter((v) => (v.views ?? 0) >= minViews)
    .sort(SORTERS[$("#sort").value]);

  results.replaceChildren(...list.map(renderCard));

  if (!state.loading && state.query) {
    const hidden = state.videos.length - list.length;
    status.classList.remove("error");
    status.textContent = list.length
      ? `${list.length} videos for “${state.query.q}”${hidden ? ` (${hidden} hidden by min views)` : ""}`
      : state.videos.length
        ? "No videos match the min views filter. Try lowering it."
        : "No videos found. Try a broader keyword or a longer time range.";
  }
}

function renderCard(v) {
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  if (v.platform === "youtube") node.classList.add("wide");

  const thumb = node.querySelector(".thumb");
  thumb.href = v.url;
  const img = node.querySelector("img");
  if (v.thumbnail) {
    img.src = v.thumbnail;
    img.referrerPolicy = "no-referrer";
  } else img.remove();

  node.querySelector(".platform").textContent = PLATFORM_LABEL[v.platform] || v.platform;
  node.querySelector(".duration").textContent = duration(v.durationSec);
  node.querySelector(".score").textContent = `🔥 ${v.score}`;

  const title = node.querySelector(".title");
  title.href = v.url;
  title.textContent = v.title || "(no caption)";

  node.querySelector(".author").textContent = v.handle && v.handle !== v.author
    ? `${v.author} · @${v.handle.replace(/^channel\//, "")}`
    : v.author;
  node.querySelector(".views").textContent = compact(v.views);
  node.querySelector(".velocity").textContent = compact(v.velocity);
  node.querySelector(".engagement").textContent = percent(v.engagement);
  node.querySelector(".age").textContent = ago(v.publishedAt);
  return node;
}

// ---------- data ----------

async function fetchPage(query, cursor) {
  const params = new URLSearchParams(query);
  if (cursor != null) params.set("cursor", cursor);
  const res = await fetch(`/api/search?${params}`);
  const data = await res.json().catch(() => ({ error: `Unexpected response (HTTP ${res.status})` }));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load({ append }) {
  if (state.loading) return;
  state.loading = true;
  goBtn.disabled = moreBtn.disabled = true;
  status.classList.remove("error");
  status.textContent = append ? "Loading more…" : "Searching…";
  if (!append) results.replaceChildren();

  try {
    const data = await fetchPage(state.query, append ? state.cursor : null);
    const seen = new Set(state.videos.map((v) => v.id));
    const fresh = data.items.filter((v) => !seen.has(v.id)).map(enrich);
    state.videos.push(...fresh);
    state.cursor = fresh.length ? data.cursor : null;
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    if (append) render();
    status.classList.add("error");
    status.textContent = err.message;
  } finally {
    goBtn.disabled = moreBtn.disabled = false;
    moreBtn.hidden = state.cursor == null;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#q").value.trim();
  if (!q) return;
  state = {
    query: { q, platform: form.platform.value, range: $("#range").value },
    videos: [],
    cursor: null,
    loading: false,
  };
  const url = new URL(location.href);
  url.search = new URLSearchParams(state.query);
  history.replaceState(null, "", url);
  load({ append: false });
});

moreBtn.addEventListener("click", () => load({ append: true }));
$("#sort").addEventListener("change", render);
$("#minViews").addEventListener("change", render);

// Restore a search from a shared link (?q=...&platform=...&range=...).
const initial = new URLSearchParams(location.search);
if (initial.get("q")) {
  $("#q").value = initial.get("q");
  const p = form.querySelector(`input[name="platform"][value="${CSS.escape(initial.get("platform") || "")}"]`);
  if (p) p.checked = true;
  if (initial.get("range")) $("#range").value = initial.get("range");
  form.requestSubmit();
}
