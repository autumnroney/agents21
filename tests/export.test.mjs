import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_COLUMNS, csvCell, csvFilename, csvRow, safeUrl, toCsv, toPlainText } from "../public/export.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const row = {
  platform: "tiktok", title: "Gym tips, part 2", author: "Coach \"K\"", handle: "coachk",
  url: "https://www.tiktok.com/@coachk/video/1", views: 500000, likes: 60000, comments: 3000, shares: 2000,
  velocity: 50000.04, engagement: 0.13, score: 85, publishedAt: "2026-10-20T02:00:00.000Z", durationSec: 33,
};

test("header row has the PRD columns in order", () => {
  assert.deepEqual(CSV_COLUMNS, [
    "platform", "title", "author", "handle", "url", "views", "likes", "comments", "shares",
    "views_per_hour", "engagement_rate", "viral_score", "published_at", "duration_sec",
  ]);
  const csv = toCsv([row]);
  assert.ok(csv.startsWith("﻿platform,title,author,handle,url,views,"));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(csv.split("\r\n").length, 3);
});

test("escapes commas, quotes and line breaks", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("cr\r"), '"cr\r"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(NaN), "");
  assert.equal(csvRow(row),
    'tiktok,"Gym tips, part 2","Coach ""K""",coachk,https://www.tiktok.com/@coachk/video/1,500000,60000,3000,2000,50000,0.13,85,2026-10-20T02:00:00.000Z,33');
});

test("neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("  =1+1"), "'  =1+1");
  assert.equal(csvCell("\t=1"), "'\t=1");
  assert.equal(csvCell("=1,2"), "\"'=1,2\"");
  assert.equal(csvCell("a=b"), "a=b"); // only a leading formula character counts
  assert.equal(csvCell(-5), "-5"); // numbers are ours, not upstream text
});

test("missing values are blank; only http(s) URLs are exported", () => {
  const yt = { platform: "youtube", title: "", author: "A", handle: null, url: "javascript:alert(1)", views: 10, likes: null, comments: null, shares: null, velocity: null, engagement: null, score: 50, publishedAt: null, durationSec: null };
  assert.equal(csvRow(yt), "youtube,,A,,,10,,,,,,50,,");
  assert.equal(safeUrl("HTTPS://x.y"), "HTTPS://x.y");
  assert.equal(safeUrl("data:text/html,x"), "");
});

test("filename is a safe slug with the date", () => {
  assert.equal(csvFilename("Gym Tips!", new Date(NOW)), "viral-finder-gym-tips-2026-10-20.csv");
  assert.equal(csvFilename("../../etc", new Date(NOW)), "viral-finder-etc-2026-10-20.csv");
  assert.equal(csvFilename("", new Date(NOW)), "viral-finder-results-2026-10-20.csv");
});

test("plain-text copy lists rank, title, URL and key stats", () => {
  const text = toPlainText([row, { ...row, title: "Second\nline", url: "javascript:x", handle: "", author: "Anon", platform: "youtube-shorts" }], "gym tips", NOW);
  assert.equal(text, [
    "Viral Finder results for “gym tips” (2 videos)",
    "",
    "1. Gym tips, part 2",
    "   https://www.tiktok.com/@coachk/video/1",
    "   TikTok · @coachk · 500K views · 50K views/hr · 13.0% engagement · viral score 85 · 10h ago",
    "",
    "2. Second line",
    "   Shorts · Anon · 500K views · 50K views/hr · 13.0% engagement · viral score 85 · 10h ago",
    "",
  ].join("\n"));
});
