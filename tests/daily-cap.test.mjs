import { test } from "node:test";
import assert from "node:assert/strict";
import { intEnv, reserveCredits, utcDay } from "../netlify/lib/daily-cap.mjs";
import { memoryStore } from "./helpers.mjs";

test("utcDay uses the UTC date", () => {
  assert.equal(utcDay(new Date("2026-10-20T23:59:59-05:00")), "2026-10-21");
});

test("intEnv parses non-negative integers and falls back otherwise", () => {
  assert.equal(intEnv("250", 500), 250);
  assert.equal(intEnv("0", 500), 0);
  assert.equal(intEnv(undefined, 500), 500);
  assert.equal(intEnv("-3", 500), 500);
  assert.equal(intEnv("lots", 500), 500);
});

test("reserveCredits counts per UTC day and refuses above the cap", async () => {
  const store = memoryStore();
  const day1 = new Date("2026-10-20T10:00:00Z");
  assert.deepEqual(await reserveCredits(store, { cap: 3, cost: 2, now: day1 }), { allowed: true, used: 2 });
  assert.deepEqual(await reserveCredits(store, { cap: 3, cost: 2, now: day1 }), { allowed: false, used: 2 });
  assert.deepEqual(await reserveCredits(store, { cap: 3, cost: 1, now: day1 }), { allowed: true, used: 3 });
  // A new UTC day starts from zero.
  const day2 = new Date("2026-10-21T00:00:01Z");
  assert.deepEqual(await reserveCredits(store, { cap: 3, now: day2 }), { allowed: true, used: 1 });
  assert.equal(store.data.get("credits-2026-10-20").value, "3");
});

test("cap of 0 blocks everything", async () => {
  assert.equal((await reserveCredits(memoryStore(), { cap: 0 })).allowed, false);
});

test("retries when another writer wins the race", async () => {
  const store = memoryStore({ failWrites: 2 });
  assert.deepEqual(await reserveCredits(store, { cap: 10 }), { allowed: true, used: 1 });
});

test("fails open under heavy contention", async () => {
  const store = memoryStore({ failWrites: 99 });
  assert.deepEqual(await reserveCredits(store, { cap: 10 }), { allowed: true, used: null });
});
