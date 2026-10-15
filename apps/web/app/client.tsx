"use client";

// Pages that read the browser (live sockets, canvases, storage) while they
// render, so they render there only. Everything else renders on the server.
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

const loading = () => (
  <div className="mx-auto max-w-[1440px] px-5 py-6">
    <Skeleton rows={6} />
  </div>
);

export const PullPage = dynamic(() => import("@/pr/PullPage").then((m) => m.PullPage), { ssr: false });
export const LiveView = dynamic(() => import("@/trunk/live/LiveView").then((m) => m.LiveView), { ssr: false, loading });
export const IssuesView = dynamic(() => import("@/trunk/live/IssuesView").then((m) => m.IssuesView), { ssr: false, loading });
export const PeopleTab = dynamic(() => import("@/trunk/live/IssuesView").then((m) => m.PeopleTab), { ssr: false, loading });
