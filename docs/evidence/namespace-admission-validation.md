# Retryable repository creation after quota refusal — 2026-11-09

Production's new-private-repository form refused a synthetic fixture with
“this address's trunk quota is reached.” No live repository was initialized.
Inspection found that the old handler reserved its owner/repository address
before checking quota. A [pinned reproduction and validation receipt](namespace-admission-validation.json)
separates that browser observation from local reproduction and fixed behavior.

The exact pre-fix source `08f99ac4060de60f2927affaa959107e6d5310bd` reproduces the
problem in a real local Worker: quota refusal returns 429, an uninitialized
address remains, and retrying the same name returns 400 “already reserved.”
This can consume the namespace's bounded address capacity and block the name
after space becomes available.

The fixed Hub reserves the address and capacity in one synchronous transaction.
A definitive owner, IP or deployment-capacity refusal rolls back the new address.
Creation-rate refusal occurs before either reservation. Successful admission
returns its existing ticket to the initializer, which does not reserve or charge
the rate counter again. Quota limits and existing rate-window behavior remain.

The route checks receiver capability before mutation. Missing, older or malformed
receiver responses stop without initializing a repository. Lost admission replies
and uncertain outcomes after initialization is dispatched retain the original
address, ID and pending capacity. This prevents a delayed initializer or lost response from
moving a clone URL to another repository. Existing names and rename aliases
remain unavailable for reassignment.

Local acceptance passes 554 API unit tests, the hosting and abuse suites, and all
three uncached pinned-tsrs workspace checks. Real Worker tests cover all quota
refusals, same-name retry after freeing fixture capacity, concurrent creation,
receiver mismatch, forged tickets, namespace ownership and lost admission,
initialization and completed HTTP acknowledgements. Existing namespaces, Git
push/clone, role isolation, secrets continuity and restart checks also pass.

This is source/local validation. Frozen Linux acceptance, production packaging
and delivery checks are still required before rollout. It does not increase
production quotas or automatically remove old orphaned/uncertain reservations.
The failed synthetic production name may retain an old reservation; no cleanup
or direct production Hub mutation was attempted.
