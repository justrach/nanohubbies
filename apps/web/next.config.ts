import type { NextConfig } from "next";

// In `next dev`, the API (packages/api) runs in `wrangler dev` on 8787 and
// these rewrites reach it. Deployed, one Worker serves both (worker.ts). They
// run before the pages are matched: /<owner>/<repo> is a page, and would
// otherwise take /api/trunks too.
const API = "http://localhost:8787";

const config: NextConfig = {
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into this package.
  agentRules: false,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${API}/api/:path*` },
        { source: "/git/:path*", destination: `${API}/git/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default config;
