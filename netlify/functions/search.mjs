// /api/search: proxies searches to the ScrapeCreators API so the API key stays
// on the server. The logic lives in netlify/lib/search-core.mjs.

import { createSearchHandler } from "../lib/search-core.mjs";

export default createSearchHandler();

export const config = {
  path: "/api/search",
  // Every call spends a paid credit, so cap how often one visitor can search.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
