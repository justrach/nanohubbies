import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

// Repository pages render on the Worker. What they read at a commit never
// changes (src/server/api.ts caches it by commit), so it goes into the
// incremental cache in R2 (NEXT_INC_CACHE_R2_BUCKET, wrangler.jsonc), with
// each region's cache in front of it. Nothing revalidates on a timer or by
// tag, so there is no tag cache and no queue.
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
});
