# Fresh deployment authority release — 2026-11-09

Nanohub Worker `c4ba93ca-50ed-4505-94b3-e6486a313ba1` serves 100% of
production traffic from validated source `ff8383f8b50300598a9983225ab16ae5bd7da45e`.
The release adds the runner-only deployment revalidation endpoint used by the
trusted native staging uploader. It checks the current lease, attempt, candidate,
environment revision and approval authority against the original authorization;
it does not issue a new authorization or extend its lifetime.

The [receipt](deployment-authority-release-receipt.json) records:

- All [nine frozen Linux gates and the frozen Mac build](meld-worker-upload-frozen-validation.json), including 521 API cases, 103 CLI cases and pinned tsrs.
- A disposable Cloudflare Worker with no production data bindings: 50 exact normal asset comparisons, 60 held responses and 16 routing cases in each mode. Provider observation confirms its deletion.
- Separate normal and held production versions, exact preservation of all 27 normal bindings, and only the recovery-hold variable added to the held version.
- Independent provider confirmation of the requested 100% deployment and the live version endpoint.
- 58 public asset comparisons, 16 public routing cases, all 21 CLI releases retained, and both installed `nh` and `nanohub` aliases at 0.4.21. The temporary installation was removed.
- Exact equality of fourteen canary resources before and after release: branches, protection, rulesets, default branch, archive, environments, collaborators, secret references, runners, PR, comments, reviewer requests, CLI credentials and Git tokens.
- Vault version `0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48` remains unchanged.

The anonymous revalidation probe initially expected 401 and observed 404. Its
expectation was corrected to the existing private-repository concealment contract;
missing credentials return 404 and an invalid runner returns 403. This is negative
authorization evidence only. No valid hosted deployment authorization was created
or exercised, and no new production credential was issued.

The release does not activate the hosted dispatcher or deploy Meld. Live Meld
upload/promotion, trusted real-service acceptance, protected merge and cutover
remain separate requirements. A held fallback is uploaded but has no traffic.
