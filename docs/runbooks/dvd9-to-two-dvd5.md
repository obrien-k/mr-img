# Runbook: dual-layer DVD → two single-layer discs

This is the process that produced `dd1-movieonly.iso` and `dd2.iso` from a mounted image of *Donnie Darko* (theatrical, US, DVD-9), with both discs burned and verified on 2026-10-05.

`dvd/recipes/donnie-darko.json` records every decision. `node bin/dvd.js script <recipe>` regenerates the exact commands, and `dvd/script.test.js` asserts they match what ran.

```bash
node bin/dvd.js script dvd/recipes/donnie-darko.json > dd.sh
caffeinate -i bash dd.sh          # macOS; burning stays manual, the script prints the command
```

## Requirements

- macOS for `hdiutil` (on Linux, swap in `mkisofs -dvd-video`).
- `brew install ffmpeg dvdauthor dvdbackup`, plus HandBrakeCLI for probing.
- **ffmpeg ≥ 9.** On 6.1 the telecine encode comes out bottom-field-first. The script's `check_field_order` step stops the run if that happens.

## 1. Probe

Measure everything before deciding anything. Each guess we made in the first attempt cost an encode.

| Tool | Gives |
|---|---|
| `HandBrakeCLI -i SRC --scan` | title 1 duration, chapter durations in ms, audio and sub tracks |
| `HandBrakeCLI -i SRC -t 0 --scan --no-dvdnav` | every title's duration |
| `dvdbackup -I -i SRC` | which titles live in which title set, aspect ratio, track counts |
| `ffprobe` on the concatenated VOBs | stream IDs (`0x80`…), frame rate, field order |

`node bin/dvd.js chapters | titles | titlesets` turns those logs into recipe values.

What the probe showed:

- **Main feature:** 1:53:08 at 720×480. The video is 23.976 film with soft pulldown (ffprobe reads it as `29.8x fps, 59.94 tbr`). Audio is a 5.1 track plus two commentaries; there's one subtitle track.
- **Size:** 7.8 GB in total. The feature's VOBs alone are 5.1 GiB, which doesn't fit on a single-layer disc (4.38 GiB).
- **Extras:** title set 2 holds an 85-minute title and a 2-minute one. Title set 3 holds the deleted scenes: title 4 plays them all, and titles 5–25 are the same scenes again, one per title. Title set 4 is a 4:3 short with mono audio.

## 2. Plan

- **Two discs.** A single disc would have meant re-encoding the extras as well.
- **Disc A** (`dd1-movieonly.iso`): the movie, re-encoded to fit, with all three audio tracks and the subs. No menu: it autoplays.
- **Disc D2** (`dd2.iso`): titles 2 and 3, copied without re-encoding, as one title with title 3 as its last chapter.
- **Video bitrate:** `4.45e9 B × 8 / 6789 s ≈ 5.24 Mbps` total. Subtract the audio and about 2% for overhead, and set **4600k**. In practice the encoder hit its quality limit (q≈2.5) and averaged only 2.6 Mbps, so the disc came out at 2.3 GB.
- **Chapters:** the start times are cumulative sums of the HandBrake chapter durations. The trailing 0.6 s stub chapter is dropped (`dvd/chapters.js`).
- **Blanks:** single-layer Verbatim (`MCC 004`), burned at 4x. Dual-layer is the least compatible format for old players, and some old players play −R but not +R.

## 3. Transform

1. Copy `VTS_01_[1-6].VOB` to local disk. Both encode passes read the files, and reading from a disc or image twice is slow.
2. Run a 2-pass MPEG-2 encode:
   - `fps=24000/1001` restores the film frames.
   - `telecine=pattern=23` hard-telecines them to 29.97i, since dvdauthor won't accept 23.976 for NTSC.
   - Map the audio and subtitle streams **by ID** (`-map 0:i:0x80`) so the commentary tracks are chosen on purpose.
3. Run `dvdbackup -t N` for titles 2 and 3. **Don't concatenate a title set's VOBs.** A plain concat plays every cell in the order it sits on disc, including cells that belong to other titles, which pushes every chapter point after the first out of place.
4. Remux the extracted titles with `-c copy`.
5. Author each disc with `dvdauthor -x <xml>`, then build the image with `hdiutil makehybrid -udf`.

## 4. Verify

The generated script stops at the first failed check:

- **Output duration** within 10 s of the probed title duration. The movie came out 6.7 s long because of a timestamp jump on the final 0.6 s cell.
- **Field order** `tt` (top field first) on the re-encoded movie.
- **`VIDEO_TS.IFO`** exists after authoring.
- **ISO size** at or below 4,700,372,992 bytes (2,295,104 blocks).
- **After burning,** `hdiutil burn` verifies the written disc.

Warnings that are safe to ignore: `buffer underflow` from the DVD muxer; `timestamp discontinuity` and `Non-monotonic DTS` at cell boundaries; and dvdauthor's `pts moves backwards` / `Discontinuity` warnings of 32–64 ms at those same boundaries.

## Mistakes along the way

| Symptom | Cause |
|---|---|
| `zsh: no matches found`, ffmpeg writing to `''` | Pasting multi-line bash arrays into zsh. Put the commands in a script file. |
| `Codec AVOption top ... is not a encoding option` | ffmpeg 9 removed `-top` as an encoder option. Pass 1 now writes to `-f null -`. |
| Pass 2 ran at 0.8x, while the same encode later ran at 8.7x | The Mac went to sleep. Run under `caffeinate -i`. |
| MakeMKV `Internal error (489)` | MakeMKV was pointed at the blank disc. The source was a mounted image. |
| `hdiutil: ... No such file or directory` | A step was skipped. The generated script runs every step in order. |

## Not done yet

The final disc 1: the movie plus the deleted scenes (title 4, 20 chapters, with the commentary track) and title 26 (4:3), behind a three-button menu.
