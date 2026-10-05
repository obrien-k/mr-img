# 1. mr-img checks and plans media for sibling projects

- Status: Proposed
- Date: 2026-10-05

## Context

Several of my projects handle media files, and each one handles them its own way:

- **DeadHonestCitation** saves non-HTML sources (PDFs, images) verbatim and takes page screenshots as citation evidence.
- **DeadSimpleCMS** and **korin-pink** publish images and other assets.

None of them shares a way to answer the basic questions about a file: what is it, what shape is it, and did a conversion keep what it was supposed to keep.

Today mr-img is a **Mars rover photo demo**:

- `/api/rover-photo` downloads a day's NASA photos, measures each one (`image-size`, width and height only) and serves the largest.
- `planAspectFit` (`server/aspect_ratio.js`) decides whether an image is cropped or padded to fit a target ratio. It is tested, but nothing calls it. Since `sharp` was dropped, nothing in the repo transforms an image.
- `janitor.js` and `_connector.js` (a Mongo-backed redirect) aren't wired to any route. The `mongodb` and `openai` dependencies are unused.
- The Dockerfile's final stage is nginx serving static files. The Node server never runs in it.

A manual job then showed the pattern this repo should own: backing up a dual-layer DVD as two single-layer discs (`docs/runbooks/dvd9-to-two-dvd5.md`). Every step followed one loop:

1. **Probe:** measure what is actually there (streams, frame rate, aspect, duration, size).
2. **Plan:** decide the transform from those measurements (bitrate budget, pulldown, which titles go on which disc).
3. **Transform:** run the tool (ffmpeg, dvdauthor).
4. **Verify:** measure the output again and compare it with the plan.

Most mistakes in that job came from skipping step 1 or step 4: a guessed frame rate, a guessed title layout, a step that never ran.

## Decision

mr-img becomes the one place sibling projects get media measured, planned and checked. The rover demo stays as the first example client.

1. **Probe produces measured facts only.** Nothing in a probe result is guessed.
2. **Plans are data plus pure functions.** A plan (a *recipe*) is a document: the probe facts it was built from, the target, and the steps. Code that turns a recipe into commands has no side effects, so it is tested by comparing its output with known-good runs. `dvd/` is the first module built this way: `dvd/recipes/donnie-darko.json` regenerates the exact commands and dvdauthor XML that made the burned discs, and the tests assert they match.
3. **Every transform ends with a verify.** Durations, field order, structure and size are re-measured. On a mismatch the job stops instead of producing something that looks plausible but is wrong. For example, the field-order check caught ffmpeg 6.1 writing bottom-field-first video where ffmpeg 9 writes top-first.
4. **Recipes and probe results are stored as documents** (NoSQL; this gives the unused `mongodb` dependency a job) and are **read through a GraphQL model**. korin-pink/stellar-api connects to ATProto through that model. A later ADR will cover it.
   - _Conflict noted 2026-10-05:_ stellar-api turns out to be Postgres + Prisma + REST/Zod/OpenAPI, with no GraphQL, document store or ATProto anywhere in the repo. So this document model can't be stellar-api's own. Evidence from mr-img has to enter stellar-api through its REST/Zod contract. The current proposal is a typed `ripVerdict` plus a schema-validated `ripManifest` on `ReleaseFile` (`docs/proposals/stellar-api-rip-evidence.md`). Whether the NoSQL + GraphQL layer lives in mr-img or in korin, and how ATProto fits, is still open.
5. **Tools run where the hardware is.** Burning, and anything else that needs a physical drive, stays a manual step printed by the generated script. mr-img never burns on its own.

## Consequences

- The repo stops being a single-purpose demo, so the README, Dockerfile and runtime have to change. Video work needs ffprobe, ffmpeg (≥ 9), dvdauthor and dvdbackup in the runtime image.
- The Docker setup has to be fixed before any of this can run as a service.
- A recipe's shape becomes a contract once it is stored. Adding a field is safe; renaming or removing one needs a version field.
- Sibling projects drop their own media heuristics and depend on mr-img.
- DeadHonestCitation's "never silently dropped" rule and the verify step reinforce each other: a capture can carry its probe result as evidence of what was saved.

## Open questions

- The GraphQL schema, and how stellar-api maps recipes and probe results to ATProto records.
- How DeadSimpleCMS and korin-pink store assets today, and where probe results attach.
- Whether `janitor.js` and `_connector.js` become the start of the document store or get deleted.
- Hash choice for content identity (SHA-256 assumed).
