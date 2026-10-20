// Privacy-friendly analytics for /api/event. The browser sends small JSON
// events; we keep only allowlisted fields with checked types and write them
// to the function log as one structured line. No cookies, and no IP address,
// user agent or query text is read or stored (query length is a bucket).

const PLATFORM = ["tiktok", "shorts", "youtube", "all"];
const VIDEO_PLATFORM = ["tiktok", "youtube", "youtube-shorts"];
const RANGE = ["day", "week", "month", "3months", "all"];
const SORT = ["score", "velocity", "views", "engagement", "newest"];
const QUERY_LEN = ["1-10", "11-20", "21-50", "51+"];
const CODES = [
  "bad_request", "rate_limited", "out_of_credits", "daily_limit", "disabled",
  "upstream_error", "timeout", "config", "network", "unknown",
];

// Field type: an array is an enum, "int" a whole number 0..1e7, "bool" a boolean.
export const EVENTS = {
  search: { platform: PLATFORM, range: RANGE, query_len: QUERY_LEN, from_shared_link: "bool" },
  results_shown: { platform: PLATFORM, range: RANGE, page: "int", count: "int", total: "int", latency_ms: "int" },
  load_more: { platform: PLATFORM, page: "int", results_so_far: "int" },
  video_open: { platform: VIDEO_PLATFORM, rank: "int", score: "int", sort: SORT },
  copy_link: {},
  error: { platform: PLATFORM, code: CODES, page: "int" },
};

const MAX_BODY = 2048;

function cleanValue(type, v) {
  if (Array.isArray(type)) return type.includes(v) ? v : undefined;
  if (type === "int") return Number.isInteger(v) && v >= 0 && v <= 1e7 ? v : undefined;
  if (type === "bool") return typeof v === "boolean" ? v : undefined;
  return undefined;
}

// Returns a sanitized event, or null if it isn't one we accept.
export function sanitizeEvent(body) {
  if (!body || typeof body !== "object" || !Object.hasOwn(EVENTS, body.name)) return null;
  const schema = EVENTS[body.name];
  const props = body.props && typeof body.props === "object" ? body.props : {};
  const out = { name: body.name };
  // Random per-tab id from sessionStorage, used for per-session KPIs only.
  if (typeof body.sid === "string" && /^[a-f0-9]{16,32}$/.test(body.sid)) out.sid = body.sid;
  for (const [field, type] of Object.entries(schema)) {
    const v = cleanValue(type, props[field]);
    if (v !== undefined) out[field] = v;
  }
  return out;
}

export async function handleEvent(req) {
  const noStore = { "cache-control": "no-store" };
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST.", code: "bad_request" }, { status: 405, headers: { ...noStore, allow: "POST" } });
  }
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "Event too large.", code: "bad_request" }, { status: 413, headers: noStore });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const event = sanitizeEvent(body);
  if (!event) return Response.json({ error: "Unknown event.", code: "bad_request" }, { status: 400, headers: noStore });
  console.log(JSON.stringify({ type: "event", ...event }));
  return new Response(null, { status: 204, headers: noStore });
}
