import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ago, compact, duration, engagementRate, enrich, errorCode, hoursSince, normalizeQuery, percent,
  queryLengthBucket,
} from "../public/score.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();

test("hoursSince clamps to 1 hour and handles bad dates", () => {
  assert.equal(hoursSince(hoursAgo(10), NOW), 10);
  assert.equal(hoursSince(hoursAgo(0.1), NOW), 1);
  assert.equal(hoursSince(null, NOW), null);
  assert.equal(hoursSince("3 days ago", NOW), null);
});

test("engagementRate", () => {
  assert.equal(engagementRate({ views: 100, likes: 5, comments: 3, shares: 2 }), 0.1);
  assert.equal(engagementRate({ views: 100, likes: 5 }), 0.05);
  assert.equal(engagementRate({ views: 0, likes: 5 }), null);
  assert.equal(engagementRate({ views: 100, likes: null }), null);
});

test("formatting helpers", () => {
  assert.equal(compact(1234567), "1.2M");
  assert.equal(compact(null), "—");
  assert.equal(compact(NaN), "—");
  assert.equal(percent(0.1234), "12.3%");
  assert.equal(percent(null), "—");
  assert.equal(ago(hoursAgo(5), NOW), "5h ago");
  assert.equal(ago(hoursAgo(48), NOW), "2d ago");
  assert.equal(ago(hoursAgo(24 * 90), NOW), "3mo ago");
  assert.equal(ago(hoursAgo(24 * 800), NOW), "2y ago");
  assert.equal(ago(null, NOW), "—");
  assert.equal(duration(0), "");
  assert.equal(duration(65), "1:05");
  assert.equal(duration(3725), "1:02:05");
});

test("query helpers", () => {
  assert.equal(normalizeQuery("  Gym \t TIPS "), "gym tips");
  assert.equal(queryLengthBucket("gym"), "1-10");
  assert.equal(queryLengthBucket("x".repeat(15)), "11-20");
  assert.equal(queryLengthBucket("x".repeat(40)), "21-50");
  assert.equal(queryLengthBucket("x".repeat(60)), "51+");
});

test("errorCode prefers the server code and maps Netlify's 429", () => {
  assert.equal(errorCode(503, { code: "daily_limit" }), "daily_limit");
  assert.equal(errorCode(429, null), "rate_limited");
  assert.equal(errorCode(504, null), "timeout");
  assert.equal(errorCode(500, null), "unknown");
});

test("enrich adds velocity, engagement and the v1.1a inputs", () => {
  const v = enrich({ platform: "tiktok", views: 10000, likes: 900, comments: 50, shares: 50, publishedAt: hoursAgo(10) }, NOW);
  assert.equal(v.velocity, 1000);
  assert.equal(v.engagement, 0.1);
  assert.equal(v.ageHours, 10);
  assert.ok(Math.abs(v.adjVelocity - 10000 / 12 ** 0.6) < 1e-9);
  assert.equal(v.smoothEngagement, (900 + 100 + 150 + 500) / 15000);
});
