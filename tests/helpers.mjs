// Shared test helpers: an in-memory stand-in for a Netlify Blobs store,
// a mocked fetch for the ScrapeCreators API, and console capture.

export function memoryStore({ failWrites = 0 } = {}) {
  const data = new Map();
  let version = 0;
  let failures = failWrites;
  return {
    data,
    async getWithMetadata(key) {
      const e = data.get(key);
      return e ? { data: e.value, etag: e.etag, metadata: {} } : null;
    },
    async set(key, value, opts = {}) {
      const e = data.get(key);
      if (failures > 0) {
        failures--;
        return { modified: false }; // simulate another writer winning the race
      }
      if (opts.onlyIfNew && e) return { modified: false };
      if (opts.onlyIfMatch && (!e || e.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `"${++version}"`;
      data.set(key, { value, etag });
      return { modified: true, etag };
    },
  };
}

const now = Math.floor(Date.now() / 1000);

export const tiktokBody = {
  success: true,
  credits_remaining: 4321,
  cursor: 12,
  search_item_list: [
    {
      aweme_info: {
        aweme_id: "1", desc: "<img src=x onerror=alert(1)>", create_time: now - 7200, duration: 15,
        author: { unique_id: "bob", nickname: "Bob" },
        statistics: { play_count: 500000, digg_count: 50000, comment_count: 1000, share_count: 2000 },
        video: { cover: { url_list: ["https://x/c.jpg"] } },
      },
    },
    { aweme_info: { aweme_id: "1" } }, // duplicate id
    { aweme_info: {} }, // no id: dropped
  ],
};

export function youtubeBody(type = "video") {
  return {
    success: true,
    credits_remaining: 4999,
    videos: type === "video"
      ? [{ type: "video", id: "y1", url: "javascript:alert(1)", thumbnail: "javascript:x", title: "YT", viewCountInt: 1000, publishedTime: new Date().toISOString(), lengthSeconds: 254, channel: { title: "Ch", handle: "ch" } }]
      : [],
    shorts: type === "short" ? [{ type: "short", id: "s1", title: "Short", viewCountInt: 50 }] : [],
    continuationToken: type === "video" ? "abc" : null,
  };
}

// Installs a fake fetch. `routes` maps "tiktok" | "videos" | "shorts" to a
// function returning a Response (or throwing). Returns the list of calls.
export function mockFetch(routes = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    const kind = u.pathname.includes("tiktok") ? "tiktok" : u.searchParams.get("type");
    calls.push({ kind, url: u, key: opts?.headers?.["x-api-key"] });
    const route = routes[kind];
    if (route) return route(u);
    if (kind === "tiktok") return Response.json(tiktokBody);
    return Response.json(youtubeBody(kind === "shorts" ? "short" : "video"));
  };
  return calls;
}

export function captureConsole() {
  const lines = { log: [], warn: [], error: [] };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(lines)) console[k] = (...a) => lines[k].push(a.join(" "));
  lines.restore = () => Object.assign(console, orig);
  return lines;
}
