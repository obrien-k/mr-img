# 1. mr-img checks and plans media for sibling projects

- Status: Proposed
- Date: 2026-10-05

## Context

Several of my projects handle media files, and each one handles them its own way:

- **DeadHonestCitation** saves non-HTML sources (PDFs, images) verbatim and takes page screenshots as citation evidence.
- **DeadSimpleCMS** and **korin-pink** publish images and other assets.

None of them shares a way to answer the basic questions about a file: what is it, what shape is it, and did a conversion keep what it was supposed to keep.

mr-img already answers some of these questions for images. `server/metadata.js` measures dimensions. `server/aspect_ratio.js` decides whether an image is cropped or padded to fit a target ratio.

A recent manual job showed the same pattern at a larger scale: backing up a dual-layer DVD as two single-layer DVD-Video discs. Each step followed one loop:

1. **Probe:** measure what is actually there (streams, frame rate, aspect, duration, size).
2. **Plan:** decide the transform from those measurements (bitrate budget, pulldown, which titles go on which disc).
3. **Transform:** run the tool (ffmpeg, dvdauthor).
4. **Verify:** measure the output again and compare it with the plan (frame count, duration, chapter points, final size against the disc capacity).

Most of the mistakes in that job came from skipping step 1 or step 4: a guessed frame rate, a guessed title layout, a step that was never run.

## Decision

mr-img becomes the one place where sibling projects get media measured, planned and checked. They stop doing that work themselves.

1. **Probe returns a manifest.** mr-img inspects a file and returns a JSON manifest of measured facts only: type, dimensions or resolution, aspect ratio, duration, streams, byte size and a content hash. Nothing in the manifest is guessed.
2. **Plans are pure functions over manifests.** A plan takes a manifest and a target (for example "16:9 at 1600px wide" or "fit a 4.7 GB DVD-5") and returns the steps to get there. `planAspectFit` is the first plan of this kind. Plans don't touch files, so they are easy to test.
3. **Every transform ends with a verify.** After a transform, mr-img probes the output and compares it with the plan. If they don't match, the job fails loudly instead of producing a file that looks plausible but is wrong.
4. **Callers use the existing HTTP server or a CLI.** No shared library has to be imported into the Node, Python and static-site projects. Callers keep the manifest next to the file they store.

## Consequences

- Sibling projects lose their own media heuristics and depend on mr-img being reachable, or at least on its CLI being installed.
- Manifests become a contract. Adding a field is safe; renaming or removing one is a breaking change and needs a version field.
- Video and disc work needs ffprobe and ffmpeg in mr-img's runtime (Dockerfile). Today it only handles images.
- DeadHonestCitation's "never silently dropped" rule and mr-img's verify step reinforce each other: a capture can carry its manifest as evidence of what was saved.

## Open questions

- How DeadSimpleCMS and korin-pink store assets today, and where a manifest would live for each.
- Whether the DVD backup pipeline (probe → 2-pass MPEG-2 → dvdauthor → ISO) belongs in mr-img itself or stays a script that only uses mr-img's probe and verify.
- Hash choice (SHA-256 is the default assumption).
