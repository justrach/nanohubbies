# Git branch and tag names

Nanohub accepts well-formed UTF-8 branch/tag names with Git reference syntax,
including Unicode, emoji, quotes, dollar signs, semicolons, literal percent signs
and Git-valid Unicode whitespace. Names are never trimmed, case-folded or
Unicode-normalized. NFC and NFD spellings remain distinct identities.

The **complete reference** is bounded to 255 UTF-8 bytes, including `refs/heads/`
or `refs/tags/`. ASCII suffixes can therefore use 244 branch bytes or 245 tag
bytes; non-ASCII characters consume multiple bytes. This follows
[GitHub's documented reference byte limit](https://docs.github.com/en/migrations/using-github-enterprise-importer/migrate-from-gitlab/understand-migrations).
Git's ref syntax rules still reject ASCII controls/space, `..`, `@{`, invalid
slashes/components and reserved punctuation. See
[Git's reference format](https://git-scm.com/docs/git-check-ref-format).

When creating a ref, Nanohub also rejects a suffix beginning `refs/` or consisting
of exactly 40 hexadecimal characters, following
[GitHub's documented ambiguity restrictions](https://docs.github.com/en/get-started/using-git/dealing-with-special-characters-in-branch-and-tag-names).
Existing refs accepted by earlier Nanohub versions remain addressable for
protected updates and deletion; adding the creation check does not strand them.
Only branch/tag namespaces are supported. Git repositories can choose their
[default branch](default-branch.md) without renaming any refs.

## Storage, transport and policies

The same ref syntax applies to Git pushes, API branch writes, release labels,
activity filters and CI identities. Tag suffixes use their actual tag prefix for
the byte budget. A leading dash or a branch named HEAD is a full Git ref even
when Git's local branch shorthand is inconvenient; the host does not reinterpret
such suffixes as command-line options or revision expressions.

Receive-pack decodes command bytes strictly as UTF-8. Malformed UTF-8/framing is
rejected with HTTP 400, rather than replacing bytes with U+FFFD and addressing a
different ref. Advertisements and the migration verifier preserve Unicode
whitespace. Import selectors retain everything after the first `#`, including
literal `#`, `%` and Unicode whitespace. Refs, object IDs and names survive mirror
clone and committed-ref migration without rewriting.

Classic protections and deployment patterns accept up to 255 UTF-16 code units;
full ruleset ref patterns accept up to 255 as well. Exact Unicode/punctuation
names and long refs can be targeted. Existing path-rule entry bounds remain
unchanged. Native glob `*`, `?`, `**` and positive ASCII classes retain their
current behavior. Braces and a closing `]` are literals, not brace alternation.
Backslash quoting and complemented classes remain unsupported.

Pattern editors remove ASCII line padding only; a Unicode non-breaking space,
BOM or line separator inside a name remains part of the target. Lock, creation,
metadata, signature, current source and deployment checks continue to run on the
exact stored ref. This change does not add a bypass or normalize lookalike names.

## UI and CLI

Branches browse using encoded query parameters, so a literal `%2F` stays distinct
from `/`. Ref text is React-escaped; branch labels use bidirectional isolation.
Branch creation and release forms permit Unicode and defer syntax/byte validation
to the server. Long names and command blocks wrap or scroll within their own
containers at narrow widths.

Copied Git commands fetch the quoted **full** ref, inspect FETCH_HEAD in a
detached checkout and push an explicit quoted `HEAD:refs/heads/<name>` refspec.
Quotes and shell punctuation remain data. A name containing `$(...)` is never
executed as a command by the generated instructions.

CLI v0.4.4 accepts value assignments such as `--head=-leading`, preserving
leading dashes, additional `=` characters and empty `--body=` values. Duplicate
valued options and values on boolean flags remain rejected. The native PR API
receives names unchanged. Git itself may require full ref names instead of local
branch shorthand; repository restrictions still apply.

Run `bun run --filter @swarm/api test:refs` for real Git-format comparison, SQL,
wire and Worker/Git/migration/CLI checks. See
[validation evidence](evidence/ref-names-validation.md).
