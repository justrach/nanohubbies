"use client";

import { createContext, useContext } from "react";
import type { RoomView } from "@/lib/room";
import type { PushToken } from "@/onboarding/usePushTokens";
import type { ImportStatus } from "@/onboarding/useImportStatus";
import type { Head, RepoInfo } from "@/lib/types";

/** What every page of a trunk knows about it. Changes at most every few
 *  seconds, so pages that read only this do not redraw as changes land. */
export interface TrunkState {
  trunk: string;
  /** The newest published version: what clones and these pages read. */
  head: Head | null;
  /** The newest landed version, which may still be publishing. */
  tip: number;
  /** The GitHub repository it was imported from. */
  repo: RepoInfo | null;
  importJob: ImportStatus | null;
  initialTokens: { owner: string | null; tokens: PushToken[] };
}

export const TrunkContext = createContext<TrunkState | null>(null);

/** The room's live feed: redraws on every frame, so only live parts read it. */
export const RoomContext = createContext<RoomView | null>(null);

export function useTrunk(): TrunkState {
  const t = useContext(TrunkContext);
  if (!t) throw new Error("useTrunk outside a trunk's pages");
  return t;
}

export function useLiveRoom(): RoomView {
  const r = useContext(RoomContext);
  if (!r) throw new Error("useLiveRoom outside a trunk's pages");
  return r;
}
