import type { Session } from "@/lib/session";
import type { RepoInfo, TrunkInfo, TrunkListing } from "@/lib/types";
import type { ImportStatus } from "@/onboarding/useImportStatus";
import type { PushToken } from "@/onboarding/usePushTokens";

/** One authorized server render supplies initial chrome and setup state. */
export interface WorkspaceBootstrap {
  workspace: TrunkListing;
  info: TrunkInfo | null;
  job: ImportStatus | null;
  repo: RepoInfo | null;
  session: Pick<Session, "user" | "providers">;
  tokens: PushToken[];
}
