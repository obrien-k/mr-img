# Runbook: `audio-cd`

This runbook covers installing and using `audio-cd`, which burns a FLAC + CUE rip back onto a physical Audio CD. Design and safety guarantees: `docs/prd/audio-cd.md`.

## Install (macOS)

```bash
brew install node ffmpeg cdrdao
```

**`cue2toc` is the one tool I couldn't confirm.** I had no network access to Homebrew from where this was built, so check how you get it on your machine:

```bash
command -v cue2toc || brew info cue2toc || brew list cdrdao | grep -i cue2toc
```

If none of those finds it, build it from source. cue2toc 0.4 is a small C program; `./configure && make && make install` installs it into `/usr/local`. Either way, `audio-cd` checks for all three tools before doing anything and names any that are missing.

Then put `audio-cd` on your PATH:

```bash
git clone https://github.com/obrien-k/mr-img && cd mr-img
npm link                   # installs the `audio-cd` command (and `dvd`)
# or, without npm link:
alias audio-cd="node $PWD/bin/audio-cd.js"
```

The tool needs Node 18.3 or newer and has no npm dependencies.

## Use

```bash
audio-cd "./Album [FLAC]/" --check      # validate + build the TOC; drive not touched
audio-cd "./Album [FLAC]/"              # ...plus cdrdao simulate (needs a blank in the drive)
audio-cd "./Album [FLAC]/" --burn       # ...plus cdrdao write, only after the simulation passes
```

| Option | |
|---|---|
| `--device DEV` | cdrdao device. Default: the only drive `cdrdao scanbus` lists. On macOS it looks like `IOCompactDiscServices` or `IOCompactDiscServices/1`. |
| `--speed N` | write and simulate speed. Burning audio slower than the drive's maximum is the safer bet for old players. |
| `--capacity MIN` | blank capacity, default `80`. Use `74` for 650 MB blanks. |
| `--cue NAME` | which CUE to use when the folder has several (for example a gaps-appended and a gaps-prepended CUE). You can also pass the `.cue` path directly. |
| `--appended-gaps` | needed for EAC/XLD "gaps appended to previous track" CUEs. The audio is unchanged, but the INDEX 00 markers are dropped. |
| `--keep-workdir` | keep `disc.cue`, `disc.toc`, the WAVs and `commands.sh`, and print where they are |
| `--workdir PATH` | use a new or empty directory instead of `$TMPDIR/audio-cd-XXXX` |
| `--verbose` | also print the ffmpeg commands and MD5 confirmations |

What a normal run prints:

```
CUE: /Users/kai/Music/Album [FLAC]/Album.cue
Tracks: 13 in 13 FILE(s)
Workdir: /var/folders/…/audio-cd-Xk2p1Q
  decode 01 Track.flac -> 01 Track.wav
  …
$ cue2toc -o …/disc.toc …/disc.cue
$ cdrdao show-toc …/disc.toc

Disc: 13 tracks
Total: 54:02
Capacity: 80:00
Remaining: 25:58
Status: FITS

$ cdrdao scanbus
Drive: IOCompactDiscServices (…)
$ cdrdao simulate --device IOCompactDiscServices …/disc.toc
Simulation OK.
No disc written. Re-run with --burn to write it.
```

`Total` includes the 2-second pregap before track 1 that every Audio CD has.

## When it stops

| Message | Meaning / fix |
|---|---|
| `N .cue files … pick one with --cue` | The folder has several CUEs. Pick one. |
| `CUE references "X", which does not exist` | The CUE and the files disagree. The tool also tries `X.flac` and `X.wav`; fix the CUE in a copy, never in place. |
| `unsupported audio source` | Only a lossy file (MP3 and so on) was found for that track. Burning it would be lossy, so the tool refuses. |
| `… gaps appended to previous track …` | Use `--appended-gaps`, or the rip's other CUE if it has a "gaps prepended" or "noncompliant" one. |
| `ignoring existing X.wav (…)` | A WAV sits next to the FLAC but doesn't match it. It's left alone and the FLAC is decoded instead. |
| `decoded audio does not match the FLAC's MD5` | The decode wasn't bit-exact. Don't burn; check the FLAC with `flac -t`. |
| `no optical drive found` | The drive isn't connected, or macOS hasn't released it. Run `cdrdao scanbus` yourself. |
| `simulation failed … not burning` | Usually the blank (missing, used, too small) or the drive. Nothing was written. |

## What it never does

- Write anything into the music folder.
- Burn without `--burn`, or after any failed check or simulation.
- Add 2-second gaps, or otherwise change the CUE's track layout (except `--appended-gaps`, when you ask for it).
- Call the result an ISO. An Audio CD is CD-DA; there's no filesystem on it.
