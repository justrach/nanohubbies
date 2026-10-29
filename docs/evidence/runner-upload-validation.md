# Fleet upload diagnosis and bounded transfer — 2026-10-29

Two fresh Linux acceptance attempts for implementation `3531553` stopped before
candidate execution. The second trusted controller traced startup, private image
preparation and filesystem setup successfully, followed by a 60-second timeout
on the first 512 KiB source upload. It did not repeat that uncertain upload or
claim any gate passed. Both controllers terminated and confirmed VM destruction;
separate provider reads independently confirmed it.

A third, synthetic-only disposable VM tested the same documented
`{path, contentBase64}` upload endpoint:

| Binary payload | Observation |
| --- | --- |
| 16 bytes | Uploaded and independently SHA-256 checked |
| 65,536 bytes | Uploaded and independently SHA-256 checked |
| 524,288 bytes | Request timed out after the probe's 15-second bound; outcome unknown |

An ancillary direct-exec transfer probe with a roughly 22 KiB command received
HTTP 400; it is not used as a transfer fallback. The probe VM was destroyed and
an independent provider GET confirmed `destroyed` at
`2026-10-29T08:49:31.463Z`. No candidate code ran in this probe. The exact provider
implementation/cause and maximum accepted size are not established by these
observations. The official [sandbox contract](https://codegraff.com/docs/sandboxes)
still describes the upload request shape; its advertised ceiling is not proof
that a specific payload works through every backend.

## Correction

The dispatcher now sends binary chunks of at most 64 KiB. It assembles bundles
in a fresh private staging directory using a bounded command, instead of placing
every chunk path in the command string. A SHA-256 comparison verifies the complete
bundle before Git clone and exact-head checkout. Deadline/revocation checks run
between chunks and before candidate launch.

The generic upload helper also chunks larger files, including generated job
scripts. It verifies assembled bytes before atomically replacing the intended
destination. A corrupt or uncertain chunk stops the transfer without replacing
an existing destination or retrying the write. Staging paths are controller-owned
and unique; candidate code cannot select or write them. Cleanup remains the
disposable VM's responsibility after failure.

The focused transport tests pass, including real local shell reassembly of
binary files and quoted filenames, checksum refusal, unchanged destination after
unknown writes, bounded payload/command sizes, and cancellation before candidate
execution. All **363 API unit cases**, the hosting integration gate and pinned
tsrs checks pass. These are local acceptance plus the measured synthetic cloud
probe; the corrected complete fresh-Linux run remains a separate release gate.
No main Worker, Vault, production repository or Nanohub Actions key was changed.
