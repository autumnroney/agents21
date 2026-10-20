import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, sanitizeEvent } from "../netlify/lib/events.mjs";
import { captureConsole } from "./helpers.mjs";

function post(body, headers = {}) {
  return new Request("http://localhost/api/event", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "Secret/1.0", "x-forwarded-for": "203.0.113.9", ...headers },
  });
}

test("logs an allowlisted event with no IP, user agent or query text", async () => {
  const out = captureConsole();
  try {
    const r = await handleEvent(post({
      name: "search", sid: "0123456789abcdef",
      props: { platform: "tiktok", range: "week", query_len: "11-20", from_shared_link: true, q: "my secret query" },
    }));
    assert.equal(r.status, 204);
    assert.equal(out.log.length, 1);
    const line = JSON.parse(out.log[0]);
    assert.deepEqual(line, {
      type: "event", name: "search", sid: "0123456789abcdef",
      platform: "tiktok", range: "week", query_len: "11-20", from_shared_link: true,
    });
    assert.doesNotMatch(out.log[0], /secret|203\.0\.113|Secret\/1\.0/);
  } finally {
    out.restore();
  }
});

test("drops fields with the wrong type or value", () => {
  assert.deepEqual(
    sanitizeEvent({ name: "video_open", sid: "NOT-HEX", props: { platform: "evil", rank: -1, score: 72, sort: "score", extra: 1 } }),
    { name: "video_open", score: 72, sort: "score" },
  );
  assert.deepEqual(sanitizeEvent({ name: "results_shown", props: { count: 1.5, total: "3" } }), { name: "results_shown" });
});

test("rejects unknown events, bad JSON, big bodies and GET", async () => {
  const out = captureConsole();
  try {
    assert.equal((await handleEvent(post({ name: "constructor" }))).status, 400);
    assert.equal((await handleEvent(post({ name: "nope" }))).status, 400);
    assert.equal((await handleEvent(post("{oops"))).status, 400);
    assert.equal((await handleEvent(post({ name: "copy_link", pad: "x".repeat(3000) }))).status, 413);
    assert.equal((await handleEvent(new Request("http://localhost/api/event"))).status, 405);
    assert.equal(out.log.length, 0);
  } finally {
    out.restore();
  }
});

test("accepts every event the UI sends", () => {
  for (const name of ["search", "results_shown", "load_more", "video_open", "copy_link", "export_csv", "copy_results", "error"]) {
    assert.equal(sanitizeEvent({ name, props: {} }).name, name);
  }
  assert.deepEqual(sanitizeEvent({ name: "error", props: { code: "daily_limit", platform: "all", page: 1 } }),
    { name: "error", code: "daily_limit", platform: "all", page: 1 });
});

test("video_open keeps the score version and confidence; exports keep only a count", () => {
  assert.deepEqual(
    sanitizeEvent({ name: "video_open", props: { platform: "tiktok", score: 80, score_version: "1.1a", confidence: "medium" } }),
    { name: "video_open", platform: "tiktok", score: 80, score_version: "1.1a", confidence: "medium" },
  );
  assert.deepEqual(sanitizeEvent({ name: "video_open", props: { score_version: "9", confidence: "sure" } }), { name: "video_open" });
  assert.deepEqual(sanitizeEvent({ name: "export_csv", props: { count: 12, q: "secret" } }), { name: "export_csv", count: 12 });
  assert.deepEqual(sanitizeEvent({ name: "copy_results", props: { count: -1 } }), { name: "copy_results" });
});
