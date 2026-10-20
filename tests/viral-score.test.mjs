// The v1.1a viral score (PRD §4.4). Reproduces the PRD §4.3 worked examples
// with the v1 formula, then shows how the new model handles each finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustedVelocity, ageBucket, ageHours, enrich, fixedEngagement, fixedSpeed, MIN_REFERENCE, percentileRank,
  SCORE_VERSION, scoreAll, scoreV1, smoothedEngagement,
} from "../public/score.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
let seq = 0;
const video = ({ platform = "tiktok", views, hours, likes = null, comments = null, shares = null, publishedAt }) =>
  enrich({
    id: `v${++seq}`, platform, views, likes, comments, shares,
    publishedAt: publishedAt !== undefined ? publishedAt : hoursAgo(hours),
  }, NOW);
const scored = (list) => scoreAll(list);

// PRD §4.3 worked examples.
const ex = {
  A: () => video({ views: 500_000, hours: 10, likes: 60_000, comments: 3_000, shares: 2_000 }), // E = 13%
  B: () => video({ platform: "youtube", views: 500_000, hours: 10 }),
  C: () => video({ views: 2_000, hours: 2, likes: 400, comments: 30, shares: 70 }), // E = 25%
  D: () => video({ views: 500_000, hours: 10, likes: 0, comments: 0, shares: 0 }),
  E: () => video({ platform: "youtube", views: 50_000_000, hours: 3 * 8760 }),
  F: () => video({ platform: "youtube", views: 50_000_000, publishedAt: "3 years ago" }),
};

// Background results: 30 per platform, spread over speed. TikTok engagement
// rises with views, so each video's engagement rank equals its speed rank.
function background(platform, n = 30, hours = 10) {
  return Array.from({ length: n }, (_, i) => {
    const views = 1000 * (i + 1) ** 2;
    const tiktok = platform === "tiktok";
    return video({
      platform, views, hours,
      likes: tiktok ? Math.round(views * (0.1 + i * 0.003)) : null,
      comments: tiktok ? 0 : null, shares: tiktok ? 0 : null,
    });
  });
}

test("v1 formula reproduces the PRD §4.3 worked examples", () => {
  const want = { A: 85, B: 76, C: 72, D: 66, E: 56, F: 78 };
  for (const [k, make] of Object.entries(ex)) assert.equal(scoreV1(make()), want[k], `example ${k}`);
});

test("step 1: age-adjusted velocity V* = views / (h + 2)^0.6, missing when age is unknown", () => {
  assert.equal(ageHours(hoursAgo(10), NOW), 10);
  assert.equal(ageHours(hoursAgo(0.25), NOW), 0.25); // no 1-hour clamp
  assert.equal(ageHours("3 years ago", NOW), null);
  assert.ok(Math.abs(adjustedVelocity(1000, 2) - 1000 / 4 ** 0.6) < 1e-9);
  assert.equal(adjustedVelocity(1000, null), null);
  assert.equal(ex.F().adjVelocity, null);
});

test("step 2: shrunk engagement Ẽ = (likes + 2c + 3s + k·μp) / (views + k)", () => {
  // PRD §4.4: example C becomes ≈ 0.17.
  const c = ex.C();
  assert.ok(Math.abs(c.smoothEngagement - (400 + 60 + 210 + 500) / 7000) < 1e-12);
  assert.equal(c.smoothEngagement.toFixed(2), "0.17");
  // Priors: 10% TikTok, 3% YouTube and Shorts.
  assert.equal(smoothedEngagement({ platform: "tiktok", views: 0, likes: 0 }), 0.1);
  assert.equal(smoothedEngagement({ platform: "youtube", views: 0, likes: 0 }), 0.03);
  assert.equal(smoothedEngagement({ platform: "youtube-shorts", views: 0, likes: 0 }), 0.03);
  assert.equal(smoothedEngagement({ platform: "youtube", views: 100, likes: null }), null);
});

test("step 3: percentile ranks, ties count half, range 0..1", () => {
  assert.equal(percentileRank(1, [1, 2, 3]), 0);
  assert.equal(percentileRank(3, [1, 2, 3]), 1);
  assert.equal(percentileRank(2, [1, 2, 3]), 0.5);
  assert.equal(percentileRank(2, [2, 2, 2]), 0.5);
  assert.equal(percentileRank(5, [5]), 0.5);
  assert.deepEqual([1, 23, 24, 167, 168, 719, 720, null].map(ageBucket),
    ["day", "day", "week", "week", "month", "month", "older", null]);
});

test("step 4: weighted combination over available parts, with confidence", () => {
  const list = scored(background("tiktok"));
  for (const v of list) {
    const { speed, eng } = v.scoreInfo;
    assert.equal(speed.source, "bucket"); // 30 TikToks, all < 24 h old
    assert.equal(v.score, Math.round((100 * (0.6 * speed.pct + 0.25 * eng.pct)) / 0.85));
    assert.equal(v.scoreInfo.version, SCORE_VERSION);
    // No "outlier" part without extra API calls, so the best is Medium.
    assert.equal(v.scoreInfo.confidence, v.views < 1000 ? "low" : "medium");
  }
});

test("fewer than 20 results on a platform: fixed scale (the v1 shape)", () => {
  const list = scored(background("tiktok", MIN_REFERENCE - 1));
  const v = list.at(-1);
  assert.equal(v.scoreInfo.speed.source, "fixed");
  assert.equal(v.scoreInfo.eng.source, "fixed");
  const want = (100 * (0.6 * fixedSpeed(v.velocity) + 0.25 * fixedEngagement(v.smoothEngagement))) / 0.85;
  assert.equal(v.score, Math.round(want));
  // Exactly 20 switches to percentiles.
  assert.equal(scored(background("tiktok", MIN_REFERENCE))[0].scoreInfo.speed.source, "bucket");
  // A lone result is still scored.
  const [b] = scored([ex.B()]);
  assert.equal(b.score, Math.round(100 * fixedSpeed(b.velocity)));
});

test("percentiles are per platform: All platforms results don't rank against each other", () => {
  const tt = background("tiktok");
  const yt = background("youtube").map((v) => ({ ...v, views: v.views / 100, adjVelocity: v.adjVelocity / 100 }));
  scored([...tt, ...yt]);
  // YouTube's fastest is far slower than TikTok's, but still tops its own platform.
  assert.equal(yt.at(-1).scoreInfo.speed.pct, 1);
  assert.equal(tt.at(-1).scoreInfo.speed.pct, 1);
});

// ---------- the PRD §4.3 findings ----------

test("finding 1 (platform bias): same reach scores the same on TikTok and YouTube", () => {
  const tt = background("tiktok");
  const yt = background("youtube");
  scored([...tt, ...yt]);
  // v1: A (TikTok) 85 vs B (YouTube) 76, only because TikTok reports likes.
  for (let i = 0; i < tt.length; i++) assert.equal(yt[i].score, tt[i].score, `rank ${i}`);
  // Missing likes lowers confidence instead of the score.
  assert.equal(yt[10].scoreInfo.confidence, "low");
  assert.equal(tt[10].scoreInfo.confidence, "medium");
});

test("YouTube results without likes aren't penalized: the score is their speed alone", () => {
  const list = scored([ex.B(), ...background("youtube")]);
  for (const v of list) {
    assert.equal(v.scoreInfo.eng, null);
    assert.equal(v.score, Math.round(100 * v.scoreInfo.speed.pct));
  }
  // The fastest YouTube result can reach 100 (v1 capped it near 85-90).
  assert.equal(Math.max(...list.map((v) => v.score)), 100);
});

test("finding 2 (small-sample inflation): tiny videos can't win on engagement alone", () => {
  // v1: C (2k views) scored 72, within 4 points of B (500k views).
  const a = ex.A();
  const c = ex.C();
  scored([a, c, ...background("tiktok")]);
  assert.ok(a.score - c.score >= 20, `A ${a.score} vs C ${c.score}`);
  // 25% on 20 views is shrunk to ~the 10% prior; it no longer maxes out engagement.
  const tiny = video({ views: 20, hours: 1, likes: 5 });
  assert.ok(Math.abs(tiny.smoothEngagement - 0.1) < 0.001);
  // Same age, 100x fewer views, much higher raw engagement: still scores lower.
  const big = video({ views: 400_000, hours: 10, likes: 40_000, comments: 0, shares: 0 }); // 10%
  const small = video({ views: 4_000, hours: 10, likes: 1_600, comments: 0, shares: 0 }); // 40%
  scored([big, small, ...background("tiktok")]);
  assert.ok(big.score > small.score, `big ${big.score} vs small ${small.score}`);
  // Also on the fixed scale (fewer than 20 results).
  scored([big, small]);
  assert.ok(big.score > small.score, `fixed: big ${big.score} vs small ${small.score}`);
  // Under 1,000 views is always low confidence.
  scored([tiny, ...background("tiktok")]);
  assert.equal(tiny.scoreInfo.confidence, "low");
});

test("finding 3 (missing beats zero): missing engagement is neither a bonus nor a penalty", () => {
  // v1 gave missing engagement a fixed 10 points, more than a reported 0%.
  // Now a missing part is dropped and the rest is renormalized: a median-speed
  // video without likes scores the same as one with median engagement too.
  const tt = background("tiktok", 31);
  scored(tt);
  const median = tt[15];
  assert.equal(median.scoreInfo.speed.pct, 0.5);
  assert.equal(median.scoreInfo.eng.pct, 0.5);
  assert.equal(median.score, 50);
  const noLikes = background("tiktok", 31);
  Object.assign(noLikes[15], { likes: null, smoothEngagement: null });
  scored(noLikes);
  assert.equal(noLikes[15].score, 50);
  assert.equal(noLikes[15].scoreInfo.confidence, "low");
  // A reported 0% is real data: it ranks last on engagement, and keeps Medium confidence.
  const d = ex.D();
  scored([d, ...background("tiktok")]);
  assert.equal(d.scoreInfo.eng.pct, 0);
  assert.equal(d.scoreInfo.confidence, "medium");
});

test("finding 4 (age bias): no 1-hour cliff, and long-running hits aren't under-rewarded", () => {
  // v1 clamps to 1 h, so 30 min and 60 min give the same velocity; V* is smooth.
  const halfHour = video({ views: 10_000, hours: 0.5 });
  const hour = video({ views: 10_000, hours: 1 });
  assert.equal(halfHour.velocity, hour.velocity);
  assert.ok(halfHour.adjVelocity > hour.adjVelocity);
  assert.ok(halfHour.adjVelocity / hour.adjVelocity < 1.2);
  // Evergreen (50M in 3 years) vs a fresh clip (20k in 1 h):
  // v1 velocity favors the clip 10:1; V* favors the hit.
  const evergreen = ex.E();
  const fresh = video({ platform: "youtube", views: 20_000, hours: 1 });
  assert.ok(fresh.velocity > 10 * evergreen.velocity);
  assert.ok(evergreen.adjVelocity > 10 * fresh.adjVelocity);
  // With 20+ results in its age bucket, a video is ranked against videos of a similar age.
  const old = Array.from({ length: 25 }, (_, i) => video({ platform: "youtube", views: 1e6 * (i + 1), hours: 2000 }));
  const young = Array.from({ length: 25 }, (_, i) => video({ platform: "youtube", views: 1e3 * (i + 1), hours: 5 }));
  scored([...old, ...young]);
  assert.equal(old.at(-1).scoreInfo.speed.source, "bucket");
  assert.equal(young.at(-1).score, 100);
  assert.equal(old.at(-1).score, 100);
});

test("finding 5 (missing-date inflation): an unknown date adds no points", () => {
  // v1: F (date unparseable) scored 78, 22 above E (same video, date known).
  const e = ex.E();
  const f = ex.F();
  scored([e, f]); // fixed scale
  assert.equal(f.score, 50); // speed counts as average
  assert.ok(f.score < e.score, `E ${e.score} vs F ${f.score}`);
  // The score no longer depends on views at all when the age is unknown.
  const small = video({ platform: "youtube", views: 5_000, publishedAt: null });
  scored([small]);
  assert.equal(small.score, f.score);
  assert.equal(f.scoreInfo.speed.source, "unknown");
  assert.equal(f.scoreInfo.confidence, "low");
  // Unknown dates don't join the speed reference either.
  const list = [f, ...background("youtube")];
  scored(list);
  assert.equal(list[1].scoreInfo.speed.n, 30);
  assert.equal(f.score, 50);
});

test("finding 6 (compressed range): scores use the full 0-100 range", () => {
  const list = scored(background("tiktok"));
  const scores = list.map((v) => v.score);
  assert.equal(Math.min(...scores), 0);
  assert.equal(Math.max(...scores), 100);
  // v1 squeezed the same results (1k to 900k views) into 43-97: the slowest
  // still got 43 points and nothing reached 100.
  const v1 = list.map(scoreV1);
  assert.ok(Math.min(...v1) >= 40 && Math.max(...v1) < 100, v1.join());
});

test("finding 7 (time windows): age buckets keep different windows comparable", () => {
  // TikTok "3 months" and YouTube "this year" return different ages; within a
  // bucket of 20+ results, a 3-day-old video is only compared with 1-7 day olds.
  const week = Array.from({ length: 20 }, (_, i) => video({ views: 1000 * (i + 1), hours: 72 }));
  const older = Array.from({ length: 20 }, (_, i) => video({ views: 1e7 * (i + 1), hours: 24 * 200 }));
  scored([...week, ...older]);
  assert.equal(week.at(-1).scoreInfo.speed.source, "bucket");
  assert.equal(week.at(-1).scoreInfo.speed.n, 20);
  assert.equal(week.at(-1).scoreInfo.speed.pct, 1);
});

test("scoreAll can re-score after Load more", () => {
  const list = background("tiktok", 10);
  scored(list);
  assert.equal(list[0].scoreInfo.speed.source, "fixed");
  list.push(...background("tiktok", 15));
  scored(list);
  assert.equal(list[0].scoreInfo.speed.source, "bucket");
  assert.ok(list.every((v) => Number.isInteger(v.score) && v.score >= 0 && v.score <= 100));
});
