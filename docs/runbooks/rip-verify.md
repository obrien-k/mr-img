# Runbook: `rip-verify`

`rip-verify` ties a CD rip's files to the disc they came from and to the ripper's log, then records the evidence as a manifest. It never writes inside the rip.

```bash
rip-verify "~/Music/Album [FLAC]/" --out ~/manifests/album.json
```

- Exit codes: `0` pass, `1` fail, `3` incomplete, `2` usage error.
- The checks print to stderr. The manifest (`mr-img/rip-manifest@1`) goes to `--out`, which must be outside the rip, or to stdout.
- Needs Node 18.3 or newer and `ffmpeg`. Install it the same way as `audio-cd` (`npm link`).

## What it checks

| Check | Against | Notes |
|---|---|---|
| `toc.cddb-id` | the CDDB ID recomputed from the TOC in the `iTunes_CDDB_1` tag (XLD writes it) | proves the TOC was parsed correctly |
| `toc.track-count` | the TOC's track count | catches a missing track |
| `trackN.toc-length` | the sectors the TOC gives that track | assumes per-track files with gaps appended to the previous track, which is XLD's default |
| `trackN.flac-md5` | the MD5 stored in the FLAC header | proves the decode is bit-exact |
| `log.crc32` | the CRC32 lines in the log (XLD `CRC32 hash :`, EAC `Copy CRC`) | **the only check that can produce `pass`** |
| `log.arV2` | the AccurateRip v2 lines in the log | |

The CRC32 and AccurateRip v1/v2 values are checked against `leo-bogert/accuraterip-checksum` (the C tool whipper uses) and Python's `zlib.crc32`, on the real XLD rip and on a non-silent test signal.

## Known limits (v1)

- **One file per track only.** Single-image rips (one FLAC + CUE) are refused.
- **Log parsing is provisional.** The XLD and EAC line shapes come from my understanding of those formats, not yet from real logs, and dBpoweramp's format isn't recognized. When nothing in the log is recognized, the log checks are `skip`, so the verdict is `incomplete`, never a false `pass`.
- **Partial rips fail.** If any track of the disc is missing, the rip fails `toc.track-count`. That's deliberate.
- **The AccurateRip database isn't queried.** The manifest includes the lookup URL (`disc.accurateRip.url`) for checking separately.

## Keeping an agent's inputs under control

The agent works only from the ripper's output. It never drives XLD or dBpoweramp.

1. **Rip in the GUI.** XLD's command line can't rip, and dBpoweramp has no general command-line ripper. Keep the GUI profile fixed. Running `defaults read jp.tmkk.XLD` should print XLD's settings so they can be recorded alongside the rip (I haven't checked that domain name on a Mac).
2. **Make the library read-only to the agent, with a rule rather than a promise.** In Claude Code, add deny rules to `~/.claude/settings.json`:
   ```json
   { "permissions": { "deny": ["Edit(~/Music/**)", "Write(~/Music/**)"] } }
   ```
   These cover the file-editing tools, not shell commands. For a hard guarantee, run the agent as a macOS user with read-only access to the library.
3. **Logs, CUEs and tags are data, not instructions.** They are free text that came from outside.
4. **Only verified rips get burned or contributed.** Run `rip-verify` first and keep the manifest. stellar-api's quality grade should read the verdict (`docs/proposals/stellar-api-rip-evidence.md`).
