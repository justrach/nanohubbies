import type { Issue, IssueState } from "@/lib/types";

export type IssueFilter = "all" | IssueState;
export type IssueSort = "newest" | "oldest";

export function filterIssues(
  issues: Issue[],
  query: string,
  label: string,
  sort: IssueSort,
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return issues
    .filter((issue) => {
      if (label && !issue.labels.some((entry) => entry.name === label))
        return false;
      const text =
        `#${issue.number} ${issue.title} ${issue.author} ${issue.heldBy ?? ""} ${issue.labels.map((entry) => entry.name).join(" ")}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) =>
      sort === "newest" ? b.number - a.number : a.number - b.number,
    );
}
