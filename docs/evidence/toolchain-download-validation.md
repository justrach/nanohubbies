# Fresh-VM image archive transport — 2026-10-27

The [receipt](toolchain-download-receipt.json) records a real [Codegraff sandbox](https://codegraff.com/docs/sandboxes) and
Cloudflare HTTPS endpoint. The new [archive delivery path](../toolchain-archives.md)
avoids depending on a provider workspace snapshot for image transfer. This
receipt covers a tiny synthetic image, not the full Node/Bun toolchain or an
unattended hosted dispatcher.

## Live result

A new Cloudflare Worker serves a self-contained synthetic Docker archive and
two negative-test endpoints. It has no storage, service, vault or application
bindings. The 538-byte gzip archive contains one harmless marker file; its
Docker config ID and archive SHA-256 are computed before publication.

One fresh Codegraff fleet VM downloads the archive over HTTPS, verifies its
length/hash, loads it and reports the exact expected image ID. A
capability-shaped query with shell punctuation remains data: its sentinel file
is not created. The owner-only control script is removed after completion.
No candidate source or repository credential enters the VM.

Subsequent downloads on that VM independently reject a wrong digest, wrong
length, a 302 response containing the otherwise-valid archive, and an oversized
stream. The overflow writes 539 bytes, exactly the configured limit plus one;
no failed download is promoted to the image path. Unique completion markers
prevent the earlier successful request from completing a later failed one.

The VM is destroyed and its terminal deletion state confirmed. The Cloudflare
fixture is deleted, and a separate deployment lookup confirms `10007: Worker
does not exist`. No fixture runtime, snapshot or image distribution service is
retained. The fixture URL is public and synthetic; this is not a test of private
R2 authorization or signed-URL issuance.

The existing trusted Codegraff CI key supplies this isolated test's control
access. It is not copied into Nanohub's Actions configuration. The separately
configured Nanohub key is rechecked through a read-only sandbox request and
still receives 403 with the sandbox-scope diagnosis. No account key is created,
expanded or replaced.

## Local and controller coverage

Five new test cases cover archive configuration and mode isolation, launch and
poll behavior, streaming/file/hash/status guards, URL non-disclosure, timeout
and cancellation before dispatch, and private control-script permissions.
The existing real-Git workflow test now also exercises archive configuration
through `executeActions`; a candidate's replacement workflow still cannot
replace the accepted base's definition.

Job tests require download, load and exact-image verification before candidate
upload; a lease revoked during preparation also prevents upload. Candidate
commands retain offline networking and `--pull=never`. Failure paths destroy
the allocated sandbox and retain a cleanup receipt until confirmed. Neither
receipts, returned results, candidate files/commands nor job logs contain the
private URL. The actual cloud probe exercises the transfer/load helpers; the
subsequent final lease/expiry checks and malformed-credential rejection are
covered by controller tests. Invalid gateway header values are rejected with a
generic error before Fetch can include a credential in its own error message.

The full local API unit gate, complete real Worker/Git repository gate, hosting
and namespace integration, pinned tsrs and syntax/diff checks pass. Exact
counts are recorded in the receipt. No frontend or application runtime source
changed, so no main-site build or deployment is needed for this controller-only
change. Main-site version `1450c429-a969-483e-8383-c05d9ed8467c` remains active.
No vault deployment, production repository mutation or GitHub remote change is
performed.

## Remaining acceptance

The full toolchain archive is not published or retained; a fresh VM has not
downloaded it and run the current full offline project suite through this path.
Private artifact authorization and automatic per-job URL renewal are not
implemented by this transport. Nanohub's configured key still needs sandbox
scope. Unattended registration/dispatch, hosted callbacks, actual application
staging, complete disaster recovery and traffic acceptance remain open. The
[earlier full-image build evidence](codegraff-toolchain-validation.md) retains
its original scope and failed snapshot outcomes.
