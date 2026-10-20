import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createSearchHandler, classifyUpstream, decodeAllCursor, encodeAllCursor, normalizeQuery,
  normalizeTikTok, normalizeYouTube,
} from "../netlify/lib/search-core.mjs";
import { captureConsole, memoryStore, mockFetch, tiktokBody } from "./helpers.mjs";

const realFetch = globalThis.fetch;
let out;
let store;
let handler;

function call(qs) {
  return handler(new Request(`http://localhost/api/search${qs}`));
}

beforeEach(() => {
  out = captureConsole();
  for (const k of ["SEARCH_DISABLED", "DAILY_CREDIT_CAP", "CREDITS_ALERT_THRESHOLD"]) delete process.env[k];
  process.env.SCRAPECREATORS_API_KEY = "K";
  store = memoryStore();
  handler = createSearchHandler({ getUsageStore: () => store });
});

afterEach(() => {
  out.restore();
  globalThis.fetch = realFetch;
});

// ---------- validation ----------

test("rejects empty, too long and unknown-platform searches with bad_request", async () => {
  const calls = mockFetch();
  for (const qs of ["?q=", "?q=%20%20", `?q=${"a".repeat(201)}`, "?q=x&platform=bad", "?q=x&cursor=%3Cscript%3E"]) {
    const r = await call(qs);
    assert.equal(r.status, 400, qs);
    const body = await r.json();
    assert.equal(body.code, "bad_request");
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls.length, 0, "no upstream calls for invalid input");
});

test("invalid range falls back to week, including inherited keys", async () => {
  const calls = mockFetch();
  await call("?q=gym&range=constructor");
  assert.equal(calls[0].url.searchParams.get("date_posted"), "this-week");
});

test("missing key returns 500 config without calling upstream", async () => {
  delete process.env.SCRAPECREATORS_API_KEY;
  const calls = mockFetch();
  const r = await call("?q=gym");
  assert.equal(r.status, 500);
  const body = await r.json();
  assert.equal(body.code, "config");
  assert.doesNotMatch(body.error, /SCRAPECREATORS/);
  assert.equal(calls.length, 0);
});

// ---------- normalization ----------

test("normalizes and de-duplicates TikTok results; never returns credits", async () => {
  const calls = mockFetch();
  const r = await call("?q=gym&platform=tiktok&range=day");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(calls[0].key, "K");
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].url, "https://www.tiktok.com/@bob/video/1");
  assert.equal(body.items[0].durationSec, 15);
  assert.equal(body.cursor, 12);
  assert.equal("credits" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /credits_remaining|4321/);
});

test("YouTube results drop non-http URLs and thumbnails", async () => {
  mockFetch();
  const body = await (await call("?q=gym&platform=youtube&range=all")).json();
  assert.equal(body.items[0].url, "https://www.youtube.com/watch?v=y1");
  assert.equal(body.items[0].thumbnail, "");
  assert.equal(body.cursor, "abc");
});

test("normalizers handle flat items, ms durations and missing ids", () => {
  const t = normalizeTikTok({ aweme_id: "9", video: { duration: 12500 }, statistics: {} });
  assert.equal(t.durationSec, 13);
  assert.equal(t.views, null);
  assert.equal(normalizeTikTok({}), null);
  assert.equal(normalizeYouTube({}), null);
  assert.equal(normalizeYouTube({ id: "s", type: "short" }).platform, "youtube-shorts");
});

// ---------- cache key ----------

test("query is trimmed, collapsed and lowercased; Netlify-Vary is sent", async () => {
  assert.equal(normalizeQuery("  Gym   TIPS "), "gym tips");
  const calls = mockFetch();
  const r = await call("?q=%20%20Gym%20%20TIPS%20");
  assert.equal(calls[0].url.searchParams.get("query"), "gym tips");
  assert.equal(r.headers.get("netlify-vary"), "query=q|platform|range|cursor");
  assert.match(r.headers.get("netlify-cdn-cache-control"), /max-age=300/);
});

// ---------- error codes ----------

test("maps upstream failures to typed codes without echoing upstream text", async () => {
  const cases = [
    [() => Response.json({ message: "secret upstream detail" }, { status: 500 }), 502, "upstream_error"],
    [() => Response.json({ message: "Invalid API key" }, { status: 401 }), 500, "config"],
    [() => Response.json({ message: "nope" }, { status: 402 }), 503, "out_of_credits"],
    [() => Response.json({ success: false, message: "Insufficient credits" }), 503, "out_of_credits"],
    [() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }), 429, "rate_limited"],
    [() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, 504, "timeout"],
    [() => { throw new TypeError("fetch failed"); }, 502, "upstream_error"],
  ];
  for (const [route, status, code] of cases) {
    mockFetch({ tiktok: route });
    const r = await call("?q=gym");
    assert.equal(r.status, status, code);
    const body = await r.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(body.error, /secret|Invalid API key|Insufficient|slow down|fetch failed/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    if (code === "rate_limited") assert.equal(r.headers.get("retry-after"), "30");
  }
});

test("classifyUpstream", () => {
  assert.equal(classifyUpstream(403), "config");
  assert.equal(classifyUpstream(400, "Not enough credits"), "out_of_credits");
  assert.equal(classifyUpstream(500), "upstream_error");
});

// ---------- kill switch ----------

test("SEARCH_DISABLED=true returns 503 disabled without calling upstream", async () => {
  process.env.SEARCH_DISABLED = "true";
  const calls = mockFetch();
  const r = await call("?q=gym");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "disabled");
  assert.equal(calls.length, 0);
  assert.equal(store.data.size, 0, "kill switch does not touch the counter");
});

// ---------- daily cap ----------

test("daily cap: allows up to DAILY_CREDIT_CAP upstream calls, then 503 daily_limit", async () => {
  process.env.DAILY_CREDIT_CAP = "2";
  const calls = mockFetch();
  assert.equal((await call("?q=a")).status, 200);
  assert.equal((await call("?q=b")).status, 200);
  const r = await call("?q=c");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "daily_limit");
  assert.equal(calls.length, 2, "the blocked search never reached upstream");
});

test("daily cap: All platforms counts 3 credits", async () => {
  process.env.DAILY_CREDIT_CAP = "4";
  mockFetch();
  assert.equal((await call("?q=a&platform=all")).status, 200);
  assert.equal((await call("?q=b&platform=all")).status, 503);
  assert.equal((await call("?q=c")).status, 200, "one credit still fits");
  const [value] = [...store.data.values()].map((e) => e.value);
  assert.equal(value, "4");
});

test("daily cap defaults to 500", async () => {
  mockFetch();
  const key = `credits-${new Date().toISOString().slice(0, 10)}`;
  await store.set(key, "499");
  assert.equal((await call("?q=a")).status, 200);
  assert.equal((await call("?q=b")).status, 503);
});

test("daily cap fails open when Netlify Blobs is unavailable", async () => {
  handler = createSearchHandler({ getUsageStore: () => { throw new Error("MissingBlobsEnvironmentError"); } });
  const calls = mockFetch();
  const r = await call("?q=gym");
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(out.error.some((l) => l.includes("Netlify Blobs unavailable")));
});

// ---------- low-credit alert ----------

test("logs a warning when credits drop below CREDITS_ALERT_THRESHOLD", async () => {
  process.env.CREDITS_ALERT_THRESHOLD = "6000";
  mockFetch();
  const r = await call("?q=gym");
  assert.equal(r.status, 200);
  assert.ok(out.warn.some((l) => l.includes("credits low") && l.includes("4321")));
  assert.doesNotMatch(JSON.stringify(await r.json()), /4321/);
});

test("no low-credit warning above the default threshold (1000)", async () => {
  mockFetch();
  await call("?q=gym");
  assert.equal(out.warn.length, 0);
});

test("request log line has no raw query", async () => {
  mockFetch();
  await call("?q=very%20private%20words");
  const line = out.log.find((l) => l.includes('"fn":"search"'));
  assert.ok(line);
  assert.doesNotMatch(line, /private/);
  assert.match(line, /"q_len":18/);
});

// ---------- All platforms ----------

test("All platforms merges TikTok, Shorts and YouTube and pages with one cursor", async () => {
  const calls = mockFetch();
  const body = await (await call("?q=gym&platform=all")).json();
  assert.deepEqual(calls.map((c) => c.kind).sort(), ["shorts", "tiktok", "videos"]);
  assert.deepEqual(body.items.map((v) => v.platform).sort(), ["tiktok", "youtube", "youtube-shorts"]);
  // Shorts had no continuation, so the next page only queries TikTok and YouTube.
  assert.deepEqual(decodeAllCursor(body.cursor), { tiktok: "12", youtube: "abc" });

  calls.length = 0;
  const r2 = await call(`?q=gym&platform=all&cursor=${encodeURIComponent(body.cursor)}`);
  assert.equal(r2.status, 200);
  assert.deepEqual(calls.map((c) => c.kind).sort(), ["tiktok", "videos"]);
  assert.equal(calls.find((c) => c.kind === "tiktok").url.searchParams.get("cursor"), "12");
});

test("All platforms keeps working when one platform fails, and fails when all do", async () => {
  mockFetch({ shorts: () => Response.json({}, { status: 500 }) });
  const r = await call("?q=gym&platform=all");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).items.length, 2);

  const fail = () => Response.json({ message: "x" }, { status: 402 });
  mockFetch({ tiktok: fail, shorts: fail, videos: fail });
  const r2 = await call("?q=gym&platform=all");
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).code, "out_of_credits");
});

test("All cursor encode/decode rejects junk", () => {
  assert.equal(encodeAllCursor({ tiktok: null }), null);
  assert.equal(decodeAllCursor("not-json"), null);
  assert.equal(decodeAllCursor(Buffer.from("[1]").toString("base64url")), null);
  assert.equal(decodeAllCursor(Buffer.from('{"evil":"1"}').toString("base64url")), null);
});

test("fixture sanity", () => {
  assert.equal(tiktokBody.search_item_list.length, 3);
});
