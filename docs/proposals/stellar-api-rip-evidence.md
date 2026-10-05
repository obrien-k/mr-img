# Proposal: rip evidence for stellar-api's quality grade

- Status: Draft. For stellar-api; written here because this session can only read that repo.
- Reviewed: `orphic-inc/stellar-api` at `0de4d5b` (PRD-04; ADR-0005, 0008, 0023, 0029 and 0036; `prisma/schema.prisma`; `src/modules/contributionQuality.ts`)
- Produces the evidence: `rip-verify` in this repo (`rip/`, `bin/rip-verify.js`)

## What the review found

1. **"Perfect" grades a claim that nothing checks.** `gradeContribution()` returns **Perfect (1.0)** for FLAC plus `ReleaseFile.hasLog && hasCue`, and PRD-04 describes that tier as a "*verified* lossless rip". But `hasLog` and `hasCue` are booleans set from the upload form, and nothing checks them. Because the grade weights a member's CommunityScore stake (ADR-0017), the reputation system pays out for ticking two boxes.
2. **Log rescoring is mentioned but has nowhere to live.** `ReleaseReportCategory.LogRescoreRequest` exists, yet nothing in the schema stores a log, a log score or any checksum, so a rescore has no evidence to work from.
3. **Contributions are links, not files.** `Contribution.downloadUrl` points elsewhere, so stellar-api can't verify a rip itself. Any evidence arrives from outside and has to be bound to the exact files (by hash) so that anyone with access can recheck it.
4. **A disc fingerprint is release identity, and ADR-0036 makes identity community-private.** AccurateRip and CDDB disc IDs identify the release exactly, so they must never become a global lookup. Otherwise "which communities have this disc?" turns into an existence oracle, which is the leak ADR-0023 and ADR-0036 close.
5. **The stack is Postgres + Prisma + REST/Zod/OpenAPI.** There's no GraphQL, document store or ATProto anywhere in the repo; korin.pink is reached over service keys (ADR-0011/0013). Whatever "NoSQL + GraphQL" layer is planned therefore has to live outside stellar-api, and evidence enters stellar-api through its REST and Zod contract (see mr-img ADR-0001).

## Proposal

### Evidence travels as a manifest

`rip-verify <rip-dir> --out manifest.json` produces `mr-img/rip-manifest@1`. Per track it records:
- the SHA-256 of the file
- its sample and sector counts
- the FLAC MD5 and whether the decoded audio matched it
- the CRC32 (the same value EAC and XLD log)
- the AccurateRip v1 and v2 checksums

It also records the disc's TOC with its CDDB and AccurateRip IDs, the log's SHA-256 and ripper line, and a list of checks, each `pass`, `fail` or `skip`.

The verdict is one of:
- **`pass`**: nothing failed, and the log's CRC32s match the files.
- **`fail`**: any check contradicts the rip (a TOC length mismatch, a missing track, a log CRC32 not found, an MD5 mismatch, …).
- **`incomplete`**: nothing contradicts it, but nothing positively ties the files to a log either.

### Storage follows ADR-0008's placement rule

The evidence describes one uploaded file, so it belongs on the per-file satellite, `ReleaseFile`:

```prisma
enum RipVerdict { Unverified Incomplete Pass Fail }

model ReleaseFile {
  // …existing: bitrate, hasLog, hasCue, isScene
  ripVerdict     RipVerdict @default(Unverified)
  ripManifest    Json?      /// mr-img/rip-manifest@1, validated by a Zod schema on write
  ripVerifiedAt  DateTime?
}
```

- `ripManifest` is only ever served on the release-scoped contributions read, which is already community-gated. No route queries or indexes by disc ID, so ADR-0036 holds.
- `hasLog` and `hasCue` stay as what the uploader says. The verdict sits alongside them as what was demonstrated.

### The grade reads the verdict

- **Perfect** needs `ripVerdict = Pass`.
- **FLAC with `hasLog && hasCue` but no `Pass`** grades as **Lossless (0.9)**: claimed, not demonstrated.
- **`Fail`** grades no higher than Lossless and raises a `LogRescoreRequest`-style report for staff.

### Anyone with access can recheck it

Because the manifest pins every file's SHA-256, a consumer who downloads the release can run `rip-verify` on it and compare. That makes a `LogRescoreRequest` concrete: attach your manifest, and staff diff the two.

## Not decided here

- **The Zod schema for manifest@1** belongs in stellar-api's `src/schemas`. I can draft it once the manifest settles.
- **Whether manifests should be signed** (by the uploader, or by korin) to show where they came from. As proposed they're only bound to the files, which is enough to catch mismatches but not enough to say who produced them.
- **Log formats.** Recognizing XLD and EAC CRC lines is provisional until it's been tested on real logs. dBpoweramp isn't recognized yet.
- **How ATProto fits in:** whether manifests or releases get published as ATProto records via korin, and whether that's the "NoSQL + GraphQL" model. That's an open question for you.
