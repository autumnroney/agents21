import {
  MIN_REFERENCE, ago, ageBucket, compact, duration, enrich, errorCode, normalizeQuery, percent, queryLengthBucket,
  scoreAll,
} from "./score.js";
import { csvFilename, toCsv, toPlainText } from "./export.js";

const $ = (sel) => document.querySelector(sel);
const form = $("#search");
const qInput = $("#q");
const rangeSel = $("#range");
const sortSel = $("#sort");
const minViewsSel = $("#minViews");
const results = $("#results");
const status = $("#status");
const moreBtn = $("#more");
const endMsg = $("#end");
const goBtn = $("#go");
const copyBtn = $("#copy");
const copyNote = $("#copy-note");
const csvBtn = $("#export-csv");
const copyResultsBtn = $("#copy-results");
const helpBtn = $("#score-help");
const helpPanel = $("#score-help-panel");
const alertBox = $("#alert");
const retryBtn = $("#retry");
const cardTpl = $("#card");

const PLATFORM_LABEL = { tiktok: "TikTok", youtube: "YouTube", "youtube-shorts": "Shorts" };

let state = newState(null);
let inflight = null; // AbortController for the request in flight
let lastAction = { append: false }; // what Retry repeats
let blocked = false; // daily limit / kill switch: Search stays off
let cardNodes = new Map(); // video id -> card element, so re-sorting keeps nodes (and focus)
let cardSeq = 0;
let rerunTimer;
let copyTimer;
let sharedPending = false; // a shared link filled the form but hasn't been searched yet
let shown = []; // the results currently on screen, in order (what Export/Copy use)

function newState(query) {
  return { query, videos: [], cursor: null, loading: false, page: 0 };
}

// ---------- analytics (no cookies; nothing sent with Do Not Track / GPC) ----------

const trackingOff = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
let sid = null;

function sessionId() {
  if (sid) return sid;
  try { sid = sessionStorage.getItem("vf-sid"); } catch { /* storage blocked */ }
  if (!sid) {
    sid = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    try { sessionStorage.setItem("vf-sid", sid); } catch { /* storage blocked */ }
  }
  return sid;
}

function track(name, props = {}) {
  if (trackingOff) return;
  try {
    const body = JSON.stringify({ name, sid: sessionId(), props });
    if (!navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" }))) {
      fetch("/api/event", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics must never break the page */ }
}

// ---------- rendering ----------

const SORTERS = {
  score: (a, b) => b.score - a.score,
  velocity: (a, b) => (b.velocity ?? -1) - (a.velocity ?? -1),
  views: (a, b) => (b.views ?? -1) - (a.views ?? -1),
  engagement: (a, b) => (b.engagement ?? -1) - (a.engagement ?? -1),
  newest: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
};

// Only touch the live region when the text really changes, so re-sorting
// doesn't re-announce the same message.
function setStatus(text) {
  if (status.textContent !== text) status.textContent = text;
}

function summary(list) {
  const hidden = state.videos.length - list.length;
  return list.length
    ? `${list.length} videos for “${state.query.q}”${hidden ? ` (${hidden} hidden by min views)` : ""}`
    : state.videos.length
      ? "No videos match the min views filter. Try lowering it."
      : "No videos found. Try a broader keyword or a longer time range.";
}

function render(note = "") {
  const minViews = Number(minViewsSel.value);
  const list = state.videos
    .filter((v) => (v.views ?? 0) >= minViews)
    .sort(SORTERS[sortSel.value] || SORTERS.score);

  // Moving nodes drops focus, so put it back on the same element afterwards.
  const active = document.activeElement;
  const hadFocus = active !== results && results.contains(active);
  results.replaceChildren(...list.map(cardFor));
  if (hadFocus) (active.isConnected ? active : results).focus();

  shown = list;
  csvBtn.disabled = copyResultsBtn.disabled = list.length === 0;
  if (!state.loading && state.query) setStatus(note + summary(list));
  return list;
}

function cardFor(v) {
  let node = cardNodes.get(v.id);
  if (!node) {
    node = renderCard(v);
    cardNodes.set(v.id, node);
  }
  // Scores are relative to the whole result set, so they can change after Load more.
  if (node.dataset.score !== String(v.score)) updateScore(node, v);
  return node;
}

function renderCard(v) {
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = v.id;
  if (v.platform === "youtube") node.classList.add("wide");

  const thumb = node.querySelector(".thumb-link");
  thumb.href = v.url;
  const img = node.querySelector("img");
  if (v.thumbnail) {
    img.src = v.thumbnail;
    img.referrerPolicy = "no-referrer";
  } else img.remove();

  node.querySelector(".platform").textContent = PLATFORM_LABEL[v.platform] || v.platform;
  node.querySelector(".duration").textContent = duration(v.durationSec);

  // The score is a button: its name reads "Viral score 72 of 100" and it
  // opens a breakdown of how the number was reached.
  const breakdown = node.querySelector(".breakdown");
  breakdown.id = `breakdown-${++cardSeq}`;
  node.querySelector(".score").setAttribute("aria-controls", breakdown.id);

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

function updateScore(node, v) {
  node.dataset.score = String(v.score);
  node.querySelector(".score-num").textContent = v.score;
  node.querySelector(".score").setAttribute("aria-label", `Viral score ${v.score} of 100`);
  fillBreakdown(node.querySelector(".breakdown"), v);
}

const BUCKET_LABEL = {
  day: "posted in the last 24 hours", week: "posted 1–7 days ago", month: "posted 7–30 days ago", older: "posted over 30 days ago",
};

// Describes the v1.1a score parts (PRD §4.4) computed by scoreAll.
function fillBreakdown(el, v) {
  const info = v.scoreInfo;
  const name = PLATFORM_LABEL[v.platform] || v.platform;
  const pts = (part) => `+${Math.round(part.points)} pts`;
  const pct = (part) => Math.round(part.pct * 100);
  const fixedNote = `fewer than ${MIN_REFERENCE} ${name} results, so a fixed scale`;
  const { speed, eng } = info;
  const speedLine = speed.source === "unknown"
    ? `Speed: ${pts(speed)} (post date unknown, counted as average)`
    : speed.source === "fixed"
      ? `Speed: ${pts(speed)} (${compact(v.velocity)} views/hr; ${fixedNote})`
      : `Speed: ${pts(speed)} (faster than ${pct(speed)}% of ${name} results${speed.source === "bucket" ? ` ${BUCKET_LABEL[ageBucket(v.ageHours)]}` : ""}, age-adjusted)`;
  const engLine = !eng
    ? "Engagement: not reported, so the score uses speed only"
    : eng.source === "fixed"
      ? `Engagement: ${pts(eng)} (${percent(v.smoothEngagement)} weighted; ${fixedNote})`
      : `Engagement: ${pts(eng)} (higher than ${pct(eng)}% of ${name} results)`;
  const level = info.confidence[0].toUpperCase() + info.confidence.slice(1);
  const lines = [speedLine, engLine, `Viral score: ${info.score} of 100 · ${level} confidence`];
  const ul = document.createElement("ul");
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.append(li);
  }
  el.replaceChildren(ul);
}

function toggle(btn, panel, open = btn.getAttribute("aria-expanded") !== "true") {
  btn.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
}

// ---------- errors ----------

// [title, message, kind]: "retry" shows Try again; "block" turns Search off.
const ERROR_COPY = {
  bad_request: ["Check your search", "Enter a search term and try again.", "none"],
  rate_limited: ["Too many searches", "You're searching faster than we allow. Wait a minute, then try again.", "retry"],
  out_of_credits: ["Daily search limit reached", "Searching is paused for now. Please try again later.", "block"],
  daily_limit: ["Daily search limit reached", "We've used today's search budget. Searching reopens after midnight UTC.", "block"],
  disabled: ["Search is paused", "Search is turned off for maintenance. Please check back later.", "block"],
  timeout: ["The search took too long", "The video service was slow to answer. Try again.", "retry"],
  upstream_error: ["Search is temporarily unavailable", "The video service had a problem. Try again in a moment.", "retry"],
  config: ["Search is temporarily unavailable", "We're on it. Please try again later.", "none"],
  network: ["You seem to be offline", "Check your connection, then try again.", "retry"],
  unknown: ["Something went wrong", "Try again in a moment.", "retry"],
};

function showAlert(code, serverMessage) {
  const [title, message, kind] = ERROR_COPY[code] || ERROR_COPY.unknown;
  alertBox.classList.toggle("notice", kind === "block");
  alertBox.hidden = false;
  $("#alert-title").textContent = title;
  // Only our own validation messages come from the server; never upstream text.
  $("#alert-msg").textContent = (code === "bad_request" && serverMessage) || message;
  retryBtn.hidden = kind !== "retry";
  if (kind === "block") {
    blocked = true;
    goBtn.setAttribute("aria-describedby", "alert-msg");
  }
  if (code === "bad_request") qInput.focus();
  else (retryBtn.hidden ? alertBox : retryBtn).focus();
}

function hideAlert() {
  const hadFocus = alertBox.contains(document.activeElement);
  alertBox.hidden = true;
  if (hadFocus) qInput.focus({ preventScroll: true });
}

// ---------- data ----------

async function fetchPage(query, cursor, signal) {
  const params = new URLSearchParams(query);
  if (cursor != null) params.set("cursor", cursor);
  let res;
  try {
    res = await fetch(`/api/search?${params}`, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw Object.assign(new Error("network"), { code: "network" });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error || !Array.isArray(data.items)) {
    const code = errorCode(res.status, data);
    throw Object.assign(new Error(code), { code, serverMessage: typeof data?.error === "string" ? data.error : "" });
  }
  return data;
}

function syncControls() {
  goBtn.disabled = blocked || (state.loading && state.page === 0);
  moreBtn.disabled = state.loading;
  moreBtn.hidden = blocked || state.cursor == null;
  endMsg.hidden = !state.done;
}

async function load({ append }) {
  if (blocked || (append && state.loading)) return;
  inflight?.abort();
  const ctrl = (inflight = new AbortController());
  const s = state; // the search this request belongs to
  s.loading = true;
  s.done = false;
  lastAction = { append };
  hideAlert();
  setStatus(append ? "Loading more…" : "Searching…");
  if (!append) {
    results.replaceChildren();
    shown = [];
    csvBtn.disabled = copyResultsBtn.disabled = true;
  }
  results.setAttribute("aria-busy", "true");
  syncControls();
  const started = performance.now();
  const page = s.page + 1;

  try {
    const data = await fetchPage(s.query, append ? s.cursor : null, ctrl.signal);
    if (s !== state) return; // a newer search replaced this one
    const seen = new Set(s.videos.map((v) => v.id));
    const fresh = data.items.filter((v) => v && !seen.has(v.id)).map((v) => enrich(v));
    s.videos.push(...fresh);
    scoreAll(s.videos); // percentiles use every result loaded so far
    s.cursor = fresh.length ? data.cursor ?? null : null;
    s.page = page;
    s.loading = false;
    s.done = s.cursor == null && s.videos.length > 0;
    syncControls();
    const list = render(append ? `${fresh.length} more videos loaded. ` : "");
    track("results_shown", {
      platform: s.query.platform, range: s.query.range, page, count: fresh.length,
      total: s.videos.length, latency_ms: Math.round(performance.now() - started),
    });
    if (append) focusNew(fresh, list);
  } catch (err) {
    if (err.name === "AbortError" || s !== state) return;
    s.loading = false;
    if (append) render();
    else setStatus("");
    showAlert(err.code || "unknown", err.serverMessage);
    track("error", { platform: s.query.platform, code: ERROR_COPY[err.code] ? err.code : "unknown", page });
  } finally {
    if (s === state) {
      results.removeAttribute("aria-busy");
      syncControls();
    }
  }
}

// After Load more, move focus to the first new card so keyboard users continue
// where the new results start.
function focusNew(fresh) {
  const ids = new Set(fresh.map((v) => v.id));
  const first = [...results.children].find((n) => ids.has(n.dataset.id));
  if (first) first.querySelector(".title").focus();
  else if (!moreBtn.hidden) moreBtn.focus();
  else if (!endMsg.hidden) endMsg.focus();
  else results.focus();
}

function startSearch(query) {
  if (blocked) return;
  const same = state.query && ["q", "platform", "range"].every((k) => state.query[k] === query[k]);
  if (same && state.loading && state.page === 0) return; // ignore duplicate submits
  const fromShared = sharedPending;
  sharedPending = false;
  state = newState(query);
  cardNodes = new Map();
  writeUrl();
  showShareButtons();
  track("search", {
    platform: query.platform, range: query.range,
    query_len: queryLengthBucket(query.q), from_shared_link: fromShared,
  });
  load({ append: false });
}

// ---------- URL (shareable links) ----------

function writeUrl() {
  const base = state.query || sharedQuery;
  const params = new URLSearchParams(base ? { q: base.q, platform: base.platform, range: base.range } : {});
  if (sortSel.value !== "score") params.set("sort", sortSel.value);
  if (minViewsSel.value !== "0") params.set("minViews", minViewsSel.value);
  const url = new URL(location.href);
  url.search = params;
  history.replaceState(null, "", url);
}

function hasOption(select, value) {
  return [...select.options].some((o) => o.value === value);
}

// Fill the form from a shared link (?q=&platform=&range=&sort=&minViews=).
// It does NOT search: the visitor presses Search, so links can't spend credits.
function readSharedLink() {
  const p = new URLSearchParams(location.search);
  if (hasOption(sortSel, p.get("sort"))) sortSel.value = p.get("sort");
  if (hasOption(minViewsSel, p.get("minViews"))) minViewsSel.value = p.get("minViews");
  const q = normalizeQuery(p.get("q"));
  if (!q || q.length > 200) return null;
  qInput.value = p.get("q").trim();
  const radio = form.querySelector(`input[name="platform"][value="${CSS.escape(p.get("platform") || "")}"]`);
  if (radio) radio.checked = true;
  if (hasOption(rangeSel, p.get("range"))) rangeSel.value = p.get("range");
  return { q, platform: form.platform.value, range: rangeSel.value };
}

// ---------- events ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(rerunTimer);
  const q = normalizeQuery(qInput.value);
  if (!q) return;
  startSearch({ q, platform: form.platform.value, range: rangeSel.value });
});

// Changing Platform or Posted re-runs the current search (debounced, so
// arrowing across the platform radios only spends one search).
form.addEventListener("change", (e) => {
  if (e.target.name !== "platform" && e.target !== rangeSel) return;
  clearTimeout(rerunTimer);
  if (!state.query || blocked) return;
  rerunTimer = setTimeout(() => {
    if (normalizeQuery(qInput.value)) form.requestSubmit();
  }, 400);
});

sortSel.addEventListener("change", () => {
  render();
  writeUrl();
});
minViewsSel.addEventListener("change", () => {
  render();
  writeUrl();
});

moreBtn.addEventListener("click", () => {
  track("load_more", { platform: state.query.platform, page: state.page + 1, results_so_far: state.videos.length });
  load({ append: true });
});

retryBtn.addEventListener("click", () => load(lastAction));

function showShareButtons() {
  copyBtn.hidden = csvBtn.hidden = copyResultsBtn.hidden = false;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: copy through a temporary field.
    const tmp = document.createElement("textarea");
    tmp.value = text;
    tmp.setAttribute("readonly", "");
    tmp.className = "sr-only";
    document.body.append(tmp);
    tmp.select();
    let ok;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    tmp.remove();
    btn.focus();
    return ok;
  }
}

// Short confirmation in the copy note (a polite live region).
function note(text) {
  copyNote.textContent = text;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyNote.textContent = ""; }, 4000);
}

copyBtn.addEventListener("click", async () => {
  writeUrl();
  const ok = await copyText(location.href, copyBtn);
  note(ok ? "Link copied" : "Couldn't copy. Copy the address bar instead.");
  if (ok) track("copy_link");
});

// Export and Copy results use what is on screen (after sort and min views).
// Client-side only: no request, no credits.
csvBtn.addEventListener("click", () => {
  if (!shown.length) return;
  const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFilename(state.query?.q);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  note(`CSV downloaded (${shown.length} videos)`);
  track("export_csv", { count: shown.length });
});

copyResultsBtn.addEventListener("click", async () => {
  if (!shown.length) return;
  const ok = await copyText(toPlainText(shown, state.query.q), copyResultsBtn);
  note(ok ? `Copied ${shown.length} results` : "Couldn't copy the results.");
  if (ok) track("copy_results", { count: shown.length });
});

helpBtn.addEventListener("click", () => toggle(helpBtn, helpPanel));

results.addEventListener("click", (e) => {
  const scoreBtn = e.target.closest(".score");
  if (scoreBtn) toggle(scoreBtn, document.getElementById(scoreBtn.getAttribute("aria-controls")));
});

// Outbound clicks (left or middle button) on a card link.
function onVideoOpen(e) {
  const a = e.target.closest("a");
  if (!a || (e.type === "auxclick" && e.button !== 1)) return;
  const card = a.closest(".card");
  const v = state.videos.find((x) => x.id === card?.dataset.id);
  if (!v) return;
  track("video_open", {
    platform: v.platform, rank: [...results.children].indexOf(card) + 1, score: v.score, sort: sortSel.value,
    score_version: v.scoreInfo?.version, confidence: v.scoreInfo?.confidence,
  });
}
results.addEventListener("click", onVideoOpen);
results.addEventListener("auxclick", onVideoOpen);

// Escape closes the score explainer or a card's breakdown.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!helpPanel.hidden && (helpPanel.contains(e.target) || e.target === helpBtn)) {
    toggle(helpBtn, helpPanel, false);
    helpBtn.focus();
    return;
  }
  const card = e.target.closest?.(".card");
  const btn = card?.querySelector(".score");
  if (btn?.getAttribute("aria-expanded") === "true") {
    toggle(btn, card.querySelector(".breakdown"), false);
    btn.focus();
  }
});

// ---------- start ----------

const sharedQuery = readSharedLink();
if (sharedQuery) {
  sharedPending = true;
  showShareButtons();
  setStatus(`Shared search ready. Press Search to see results for “${sharedQuery.q}”.`);
}
