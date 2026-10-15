"use client";

import { Check, CloudDownload, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/controls";
import { LinkButton } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import type { ImportStatus } from "./useImportStatus";
import styles from "./Onboarding.module.css";

export function ImportProgress({
  job,
  onRetry,
}: {
  job: ImportStatus | null;
  onRetry: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!job || job.phase === "complete") return null;
  const failed = job.phase === "failed";
  const stage = job.ready ? 2 : job.phase === "seeding" ? 1 : 0;
  const title = failed
    ? job.ready
      ? "Your code is ready. Context needs another try."
      : "We couldn’t finish the copy."
    : job.ready
      ? "Your code is ready to work on"
      : "Your workspace is taking shape";
  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await api(`${trunkPath(job.trunk)}/import/retry`, { body: {} });
      onRetry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <section aria-label="Repository import" className={styles.importWrap}>
      <div className={styles.importCard}>
        <div className={styles.importHeading}>
          <span className={styles.icon}>
            {failed ? (
              <TriangleAlert size={20} />
            ) : job.ready ? (
              <Check size={20} />
            ) : (
              <CloudDownload size={20} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className={styles.eyebrow}>{job.repo}</p>
            <h2
              className="text-sm font-semibold"
              role={failed ? "alert" : "status"}
            >
              {title}
            </h2>
          </div>
          {!failed && (
            <span className={styles.live}>
              <span />
              In progress
            </span>
          )}
        </div>
        <ol className={styles.stages} aria-label="Copy progress">
          {["Copy source", "Prepare workspace", "Sync issues & PRs"].map(
            (label, index) => (
              <li
                key={label}
                data-state={
                  index < stage
                    ? "done"
                    : index === stage
                      ? "current"
                      : "waiting"
                }
                aria-current={index === stage ? "step" : undefined}
              >
                <span className={styles.stageLine} />
                <span className={styles.stageLabel}>
                  {index < stage ? (
                    <Check size={12} aria-hidden />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                  {label}
                  <span className="sr-only">
                    {index < stage
                      ? "complete"
                      : index === stage
                        ? failed
                          ? "needs attention"
                          : "in progress"
                        : "waiting"}
                  </span>
                </span>
              </li>
            ),
          )}
        </ol>
        <p className={styles.explain}>
          {failed
            ? job.error
            : job.ready
              ? "You can browse, clone, and change the code now. We’re bringing in the conversation from GitHub."
              : "Set up your agent or plan your first task while we copy. You can close this tab; we’ll keep going."}
        </p>
        <div className={styles.importFooter}>
          <details className={styles.details}>
            <summary>Copy details</summary>
            <dl className={styles.stats}>
              <div>
                <dt>Source files copied</dt>
                <dd>{job.files.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Source size</dt>
                <dd>{(job.bytes / 1024 / 1024).toFixed(1)} MiB</dd>
              </div>
              <div>
                <dt>Files left on GitHub</dt>
                <dd>{job.skipped.toLocaleString()}</dd>
              </div>
            </dl>
            <p>
              These are counts so far, not a percentage. Source size is the text
              copied into this workspace.
            </p>
            <p>
              We copy text files. Images and other binary files, generated
              folders, files over 256 KiB, and files beyond the 3,000-file limit
              are left out of this copy. They remain on GitHub; nothing is
              deleted.
            </p>
            {!job.ready && (
              <p>
                Cloning and code changes become available after “Prepare
                workspace.”
              </p>
            )}
          </details>
          <div className="flex flex-wrap gap-2">
            {failed && (
              <Button
                size="sm"
                onClick={() => void retry()}
                disabled={retrying}
              >
                {retrying && (
                  <Loader2
                    size={12}
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                Retry copy
              </Button>
            )}
            <LinkButton
              size="sm"
              variant="ghost"
              href={`/t/${encodeURIComponent(job.trunk)}/room`}
            >
              Open room →
            </LinkButton>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-critical">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
