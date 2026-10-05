# PRD: `audio-cd`, burning an Audio CD from a FLAC + CUE rip

- Status: Implemented (v1), not yet run against a physical drive
- Code: `audio-cd/`, `bin/audio-cd.js`. Runbook and install: `docs/runbooks/audio-cd.md`

## Problem

An owned CD, ripped to one FLAC per track plus a CUE (and an XLD/EAC log), should be burnable back to a Red Book Audio CD. The disc should have the same tracks, the same order and the same gaps as the original. The interactive version of this workflow had two problems:

- It wrote `.wav` files into the music folder (`for f in *.flac`).
- It produced `CD-TEXT: Unable to encode "(null)"` noise.

## Users and scope

- **Who:** one person, on macOS with Homebrew and an external optical drive.
- **Input:** a rip directory, or a `.cue` path. The CUE may have one `FILE` per track or a single image file. Sources are FLAC, or existing WAVs alongside them.
- **Output:** a physical CD-DA disc. **It is not an ISO.** Audio CDs have no filesystem; the authoring chain is:

```
source FLAC + CUE  →  temporary WAV + CUE  →  cdrdao TOC  →  physical Audio CD
```

- **Out of scope for v1:** CD-TEXT, BIN/CUE master images, lossy sources, and multi-session or mixed-mode discs.

## Workflow

`audio-cd <dir|file.cue> [--check | --burn] [options]`

Each step fails with a nonzero exit code and a specific message:

| # | Step | Fails on |
|---|---|---|
| 1 | Find the CUE | none found; several found without `--cue` |
| 2 | Parse and validate the CUE | malformed lines; tracks not numbered 01..n; non-AUDIO tracks; missing `INDEX 01`; out-of-order indexes; "gaps appended to previous track" layout without `--appended-gaps` |
| 3 | Resolve every `FILE` | referenced audio missing; lossy-only or other unsupported sources (FLAC is used whenever it exists) |
| 4 | Estimate capacity from FLAC/WAV headers, before decoding | the source doesn't fit |
| 5 | Check tools | `ffmpeg` (only if something needs decoding), `cue2toc` or `cdrdao` missing |
| 6 | Create the workdir | `--workdir` not empty, or inside the source directory |
| 7 | Prepare the WAVs | a decode fails; a WAV isn't 44.1 kHz / 16-bit / stereo PCM; the sample count or MD5 doesn't match the FLAC |
| 8 | Write `disc.cue` | |
| 9 | `cue2toc` | nonzero exit (any partial TOC is deleted) |
| 10 | Validate the TOC (and `cdrdao show-toc`) | type isn't `CD_DA`; track count differs from the CUE; tracks aren't sequential or aren't AUDIO; it references unknown files; cdrdao rejects it |
| 11 | Capacity, from cdrdao's own length | doesn't fit `--capacity` (default 80 min) |
| 12 | Pick the drive (`cdrdao scanbus`, or `--device`) | no drive, or several without `--device` |
| 13 | `cdrdao simulate` | nonzero exit |
| 14 | `cdrdao write --eject` (only with `--burn`) | nonzero exit |

`--check` stops after step 11 and never touches the drive. A plain run stops after step 13. Only `--burn` writes a disc.

## Safety guarantees

1. **The source directory is read-only.** The tool never creates, modifies, renames or deletes anything there. Every generated file goes in a workdir, created fresh by `mkdtemp` or given as a new or empty `--workdir`, and that workdir is refused if it's inside the source. All writes go through a helper that rejects any path outside the workdir. Every end-to-end test compares a snapshot (content hash, mtime and mode of every file) before and after the run.
2. **Nothing is burned after any failure.** The burn is the last step, it needs `--burn`, and it only runs after a passing simulation in the same run.
3. **Lossless and verified.** FLAC is decoded with `ffmpeg -i IN.flac -ar 44100 -ac 2 -c:a pcm_s16le OUT.wav` (plus flags that ignore cover-art streams and leave tags out of the WAV). Each decoded WAV's PCM is hashed and compared with the MD5 stored in the FLAC's STREAMINFO, which proves the decode is bit-exact. An existing WAV is reused (by symlinking to it from the workdir) only if it is 44.1 kHz / 16-bit / stereo PCM, has the same number of samples as its FLAC, **and** matches its MD5. Otherwise it's ignored and the FLAC is decoded. FLACs that aren't CD-native are converted, with a warning that the result is not bit-exact.
4. **The CUE's layout is authoritative.** The temporary CUE copies every `TRACK`, `INDEX`, `PREGAP`, `POSTGAP`, `FLAGS`, `ISRC`, `CATALOG` and `REM` line verbatim. It changes only `FILE` lines: the extension is replaced (`.flac` → `.wav`, never `.flac.wav`) and the type becomes `WAVE`. No gaps are added or normalized. The one exception is opt-in: with `--appended-gaps`, an EAC/XLD "gaps appended to previous track" CUE has its `INDEX 00` markers dropped. The gap audio stays exactly where it is (at the end of the previous track), so the audio is identical, but the pregap index markers are lost. cue2toc cannot express that layout at all.
5. **No CD-TEXT.** CD-TEXT fields are left out of the temporary CUE, `-n` is passed when the installed `cue2toc` supports it, and any `CD_TEXT` block that still reaches the TOC is stripped. This removes the `"(null)"` warnings at their source.
6. **Capacity is measured in sectors, not file sizes.** The check counts samples ÷ 588, plus gaps, plus track 1's mandatory 2 s pregap, against `--capacity` minutes × 60 × 75 sectors. It is checked twice: once from the headers before decoding (fail fast), and once from `cdrdao show-toc`'s reading of the real WAVs.
7. **Transparent.** Every external command is printed (`$ …`) and logged to `<workdir>/commands.sh`, so `--keep-workdir` leaves a complete, re-runnable record.
8. **Cleanup.** The workdir is removed on exit, error, SIGINT (exit 130) and SIGTERM (exit 143); a running child process is signalled first. `--keep-workdir` keeps it and prints the path.

## Decisions from probing the real tools

- **cue2toc 0.4 has no `-n`** and turns `TITLE`/`PERFORMER` into `CD_TEXT` blocks, hence point 5 above.
- On failure, **cue2toc leaves a partial TOC behind that `cdrdao show-toc` accepts**. Its exit code is therefore treated as authoritative, and the partial file is deleted.
- **`cdrdao scanbus` exits 0 even when it finds no drives**, so drives are detected by parsing its output.
- **cdrdao resolves relative `AUDIOFILE` paths against its working directory**, so all cdrdao and cue2toc calls run inside the workdir.

## Test coverage

`npm test` runs 32 tests: 14 unit and 18 end to end. The end-to-end tests use real `ffmpeg`, `cue2toc` and `cdrdao show-toc`, on audio cut from a real XLD rip (`audio-cd/test/fixtures/xld-track-10s.flac`). A stub `cdrdao` stands in for `scanbus`, `simulate` and `write`, so **no test can burn a disc**.

The 13 required cases are all covered:

1. a normal one-FLAC-per-track CUE
2–4. names with spaces, apostrophes, parentheses and brackets (plus double spaces and Unicode)
5. existing WAVs: reused when they match, ignored when they don't
6. FLAC only
7. more than 80 minutes, which fails before any decode
8. malformed CUEs and missing references
9. the source directory is never mutated (checked in every end-to-end test)
10–11. `.flac` → `.wav`, never `.flac.wav`
12. the TOC is `CD_DA`
13. track numbering is sequential

The tests also cover:

- simulation failure: nonzero exit and no write, even with `--burn`
- a failed burn
- no drive, and several drives
- missing tools
- `--workdir` inside the source directory
- a CUE-referenced WAV in the wrong format
- `--cue` selection
- workdir cleanup
- SIGINT cleanup

## Not verified yet

- A real `cdrdao simulate` and `write` on macOS with a physical drive, including what `scanbus` actually prints for your drive.
- How `cue2toc` is installed through Homebrew (see the runbook).

## Later

- A BIN/CUE master image, so a disc can be reburned without the source.
- CD-TEXT, written properly from the CUE's fields.
- Exact handling of "gaps appended" layouts, by writing the TOC directly instead of using cue2toc.
- Reading the XLD/EAC log to compare against AccurateRip/CRC values.
