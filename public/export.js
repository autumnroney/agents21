// Export helpers: CSV download and plain-text copy of the shown results.
// Client-side only (no API calls). An ES module shared with the Node tests.

import { ago, compact, percent } from "./score.js";

export const CSV_COLUMNS = [
  "platform", "title", "author", "handle", "url", "views", "likes", "comments", "shares",
  "views_per_hour", "engagement_rate", "viral_score", "published_at", "duration_sec",
];

const PLATFORM_LABEL = { tiktok: "TikTok", youtube: "YouTube", "youtube-shorts": "Shorts" };

// Only http(s) links leave the app, same rule as the cards.
export function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : "";
}

const round = (x, digits) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(digits)));

// One CSV cell. Text that a spreadsheet would run as a formula (starts with
// =, +, -, @, tab or carriage return, even after spaces) gets a leading
// apostrophe; then cells with commas, quotes or line breaks are quoted.
export function csvCell(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (/^[\t\r]|^\s*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(v) {
  return [
    v.platform, v.title, v.author, v.handle, safeUrl(v.url), v.views, v.likes, v.comments, v.shares,
    round(v.velocity, 1), round(v.engagement, 4), v.score, v.publishedAt, v.durationSec,
  ].map(csvCell).join(",");
}

// RFC 4180: CRLF line endings. The BOM lets Excel detect UTF-8 (emoji, accents).
export function toCsv(list) {
  return "﻿" + [CSV_COLUMNS.join(","), ...list.map(csvRow)].join("\r\n") + "\r\n";
}

export function csvFilename(q, now = new Date()) {
  const slug = (q || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "results";
  return `viral-finder-${slug}-${now.toISOString().slice(0, 10)}.csv`;
}

// Plain text for pasting into chats or docs: rank, title, URL, key stats.
export function toPlainText(list, q, now = Date.now()) {
  const lines = [`Viral Finder results for “${q}” (${list.length} videos)`, ""];
  list.forEach((v, i) => {
    const handle = v.handle ? `@${v.handle.replace(/^channel\//, "")}` : v.author;
    const stats = [
      PLATFORM_LABEL[v.platform] || v.platform, handle, `${compact(v.views)} views`,
      `${compact(v.velocity)} views/hr`, `${percent(v.engagement)} engagement`,
      `viral score ${v.score}`, ago(v.publishedAt, now),
    ].filter(Boolean);
    lines.push(`${i + 1}. ${(v.title || "(no caption)").replace(/\s+/g, " ").trim()}`);
    if (safeUrl(v.url)) lines.push(`   ${v.url}`);
    lines.push(`   ${stats.join(" · ")}`, "");
  });
  return lines.join("\n").trimEnd() + "\n";
}
