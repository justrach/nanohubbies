# Portable hosting CLI release — 2026-10-27

`nh` / `nanohub` v0.4.1 is published under `/nh/`, independently of the older
swarm CLI endpoints. Main Worker `f35a5b9f-a71f-422e-be5a-caabccfe0eda` is
at 100%; the vault deployment is unchanged.

## Delivery

The web build invokes `packages/cli/scripts/build.mjs` before Next.js. It uses
the [Bun bundler](https://bun.sh/docs/bundler) to produce a portable ESM command,
a Bun installer, a versioned checksum file and the public latest manifest.
No npm installation or runtime dependency fetch is needed. The CLI uses
[Bun.main](https://bun.sh/docs/runtime/utils#bun-main) to bind Git helpers to the
actual command entry, including the bundled installation.

The installer supports macOS/Linux with Bun >=1.4. It downloads only from the
selected HTTPS origin (loopback HTTP is allowed for tests), refuses redirects,
omits cookies and bounds response sizes. Manifest schema, exact version path,
byte length and SHA-256 are verified before installing. It writes a version and
checksum named module beneath the chosen user prefix, plus two managed shell
launchers. Unrelated commands and symlinks are refused before installation.
Subsequent installs update only the installer's own launchers. Old modules remain
available for existing checkout helpers; no shell profile, global Git settings,
Bun installation or account credentials are changed.

Windows launchers, standalone runtime executables, package-manager publication,
signed release attestations, and an archive of every historical hosted release
remain open. The manifest and module are served by the same trusted host; the
checksum is an integrity check, not an independently signed publisher identity.

## Tests

- **22 CLI tests / 184 assertions** pass, including a real HTTP installer process,
  both installed aliases outside the checkout, quoted paths, managed updates,
  collision preservation, corrupt download rejection, redirect refusal and
  oversized-manifest rejection.
- **196 API unit tests** pass, including exact native ownership of release paths,
  public cache behavior and missing-release refusal to fall through to legacy.
- The complete repository gate passes **151 unit tests and 21 smoke invocations**
  (20 script files plus the bundled CLI variant). The bundled variant runs actual
  Bun login, clone/fsck and ordinary Git push through the generated helper, along
  with membership, scope, protection, archive and revocation checks.
- All three pinned tsrs check tasks, the real OpenNext build and
  `git diff --check` pass. Repeated builds yield the same module digest.

## Published checks

The actual public manifest and module match the local build:

- Version: **0.4.1**
- Module bytes: **35111**
- SHA-256: `3876c9adc945b07a5c42b20272e30bac6237494053591106a6444aa34cf30269`

A fresh process downloaded the published installer and ran it in a temporary
prefix containing spaces and an apostrophe. Both installed aliases reported
`nh 0.4.1`; help and browser-destination output worked outside the checkout.
The prefix and transfer files were removed afterward. Existing global commands
were not touched. This was a real macOS arm64/Bun 1.4.4 install; Linux is supported
by the same POSIX launcher but was not executed on a Linux host in this run.

`/api/agent-help` identifies the current Worker. `/cli/authorize`, `/install.sh`
and `/download` return 200; the legacy `/cli` redirects with 307 to its own
same-origin page, which returns 200. The new release paths return 200 with the
expected public revalidation policy and no legacy fallback. A metadata-only
receipt is retained in the private local production validation directory.

Authenticated production clone/push and revocation were independently verified
for the content-scoped source CLI before packaging. See
[Git scope evidence](cli-git-validation.md) for the exact synthetic branch,
unchanged existing refs/protections, and revoked credentials. No new production
credential was needed for this download/install validation.
