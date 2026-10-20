// Global daily budget for upstream (paid) calls, counted per UTC day.
// The counter lives in Netlify Blobs; the logic only needs a store with
// Blobs' `getWithMetadata` / `set` shape, so tests can pass an in-memory one.

import { getStore } from "@netlify/blobs";

export const DEFAULT_DAILY_CREDIT_CAP = 500;

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Reads a non-negative integer env value, falling back on anything else.
export function intEnv(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Reserves `cost` credits for today. Returns { allowed, used }.
// Blobs has no atomic increment, so this is compare-and-set on the etag,
// retried a few times when another request wrote first.
export async function reserveCredits(store, { cap, cost = 1, now = new Date() }) {
  const key = `credits-${utcDay(now)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "text" });
    const used = Number(entry?.data) || 0;
    if (used + cost > cap) return { allowed: false, used };
    const next = used + cost;
    const write = entry
      ? await store.set(key, String(next), { onlyIfMatch: entry.etag })
      : await store.set(key, String(next), { onlyIfNew: true });
    if (write?.modified !== false) return { allowed: true, used: next };
  }
  // Heavy contention: let the call through rather than block real users.
  return { allowed: true, used: null };
}

// The production store. Throws outside Netlify (no Blobs environment).
export function usageStore() {
  return getStore({ name: "usage", consistency: "strong" });
}
