// /api/event: privacy-friendly analytics. Logs allowlisted events as structured
// lines in the function log. The logic lives in netlify/lib/events.mjs.

import { handleEvent } from "../lib/events.mjs";

export default handleEvent;

export const config = {
  path: "/api/event",
  // Events are cheap, but cap them so the log can't be flooded.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
