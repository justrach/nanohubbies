# Source publication — 2026-10-31 (SGT)

The feature branch
[`codex/standalone-git-host`](https://github.com/justrach/nanohubbies/tree/codex/standalone-git-host)
was published at `dbfaef167fecfa249d3652afe9ff5a6fa5ccaeed`. A subsequent remote
read matched that exact commit. GitHub main remained
`3c7675e52ca1be5521a2a51da0d6b1857340340c`; no merge or application deployment
was performed by the publication.

Before publication, Gitleaks 8.30.1 scanned all 74 unpublished commits, including
deleted lines, using its built-in rules with inline allowances ignored. Its four
generic-pattern findings were individually verified as two historical source
SHA-256 digests, a documented deployment version UUID and a static JavaScript
fixture-field assignment. No finding was waived by changing the scanner rules.
An additional history check found none of eleven configured credential values
and no full-length hex credentials with Nanohub/Codegraff token prefixes. These
are credential-pattern checks, not a full repository security assessment.

The [sanitized preflight](source-publication-preflight.json) preserves the first
73-commit scan and triage. A final private scan at the published 74-commit head
retained only those same four non-credential findings. Secret-bearing configs,
raw triage input and real Meld build logs remain outside Git.

The root workflow contains test/check jobs and no deployment job. Its first
push run [is queued](https://github.com/justrach/nanohubbies/actions/runs/41097368016).
The repository has **zero registered GitHub Actions runners**; the workflow's
`runs-on: codegraff` jobs cannot execute until a compatible runner is registered.
This is separate from Nanohub's own native runner fleet and its sandbox-scope
blocker. Neither queued GitHub checks nor successful local/cloud evidence is
reported as a completed GitHub workflow.

Local and real cloud acceptance retain their exact source/scope in the
[readiness report](../production-readiness.md) and
[Meld bridge evidence](meld-bridge-freshness-validation.md). Source review,
automated runner/release setup, actual staging/cutover and production operations
acceptance remain open.

## Subsequent source at f01806c — 2026-11-09 (SGT)

The feature branch is pushed at `f01806c20796a476e26c6eb523a81659a4243e93`.
The [31-commit follow-up scan](source-publication-f01806c.json) covers all Git
patch history since the prior published head, including removed lines, with
Gitleaks 8.30.1 built-in rules and inline allowances ignored. Its ten generic
matches are individually verified SHA-256 values: seven match historical Git
source blobs and three match retained private evidence files. No rules or
allowlists are changed. Eight configured credential values and full-length
credentials matching the recorded Nanohub/Codegraff prefix pattern are absent
from that patch range. This is not a complete repository security assessment.

The exact-head [GitHub push workflow](https://github.com/justrach/nanohubbies/actions/runs/42511696371)
is observed queued, not completed. The [real native Meld pass](meld-native-ci-live-validation.md)
is separate evidence for the application migration backend, not a successful
Nanohub GitHub workflow. No source PR, merge or runtime deployment is performed
by this follow-up verification.
