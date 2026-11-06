# Traceability — ddemammo

Target feature: `walkthrough` tool (issue #23). See `UserGuide.md` and
`packages/core/src/tool/walkthrough-analysis.ts`.

## Step 1: Requirements Review

All seven Project 3 requirements, with their original interview evidence. Six are kept
as written. R7 is revised below.

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property | Kind | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | S-1, C-1, O-1 | The tool must never modify, create, or delete any file in the analyzed repository. | Hash every file before running `walkthrough`, run it, hash again — same hashes, no new or missing files. | No | — (see note below) | — | — |
| R2 | C-2, C-3 | The tool must never list a package or dependency that isn't declared in some `package.json`, and must never skip a real workspace package. | On a fixture repo, the output never contains a package or dependency name that isn't in any `package.json`; every workspace directory with a valid manifest shows up in `## Packages`. | No | "every real package appears, and every listed dependency is real" | Invariant | `packages/core/test/tool-walkthrough-analysis.property.test.ts` |
| R3 | C-4 | File counts must not include anything under `node_modules`. | A repo with a large `node_modules` shows the real directory counts, with `node_modules` excluded. | No | "top-level counts match an independent recount that excludes node_modules" | Model/oracle | `packages/core/test/tool-walkthrough-analysis.property.test.ts` |
| R4 | S-3, S-4, C-5, C-6, O-3 | Add a package, run the tool, delete the package, run it again — the second run must match the first exactly, with no trace of the deleted package. | output₁ on a fixture repo; add a package, output₂ differs; delete it, output₃ equals output₁ byte for byte. | No | "adding then deleting a package returns to the original summary" | Round-trip | `packages/core/test/tool-walkthrough-analysis.property.test.ts` |
| R5 | S-5, S-6, C-7, C-8, C-9, O-5 | Adding one file inside a package's `src` folder should only change that package's entry line and its directory count — nothing else moves, unless the new file is itself named as an entry point in `package.json`. | Add a non-entry file to `packages/api/src/`; only `@acme/api`'s directory count changes in the output. | No | "one new non-entry file under a package's src/ changes only that top-level directory's count" | Metamorphic | `packages/core/test/tool-walkthrough-analysis.property.test.ts` |
| R6 | S-2 | The tool must never run install, build, or lifecycle scripts from any `package.json`. | Add a `postinstall` script that writes a marker file; run `walkthrough`; the marker file never appears. | No | — (see note below) | — | — |
| R7 | S-7, S-8, C-10, C-11, O-6, O-7 | *(revised — see below)* | *(revised — see below)* | **Yes** | R3's property already does what this one asks for | Model/oracle | `packages/core/test/tool-walkthrough-analysis.property.test.ts` |

**Why R1 and R6 have no property test:** both are about what the tool's code does
internally (never writes a file, never runs a script), not about how it reacts to
different input data. Feeding it random repo contents doesn't test that any harder than
one fixed example does. A mocked-filesystem test is the right check for these, and the
existing fixture tests partly cover R1 already. Both stay as requirements; testing them
properly is future work.

## Requirement changes

| ID | Original (P3) | Why it can't be built as is | What the user actually needed | Revised (P4) |
| --- | --- | --- | --- | --- |
| R7 | Provide a way to automatically check the summary against the repo's own `package.json` fields, instead of a manual comparison. | Building a real verify command is a new feature, not something this project has time or scope for, and "instead of manual comparison" isn't specific enough to test. | All three interviewees said the same thing in their own words: there's no way to check the output except by hand, and that's tedious. They wanted to be able to trust it, not necessarily a shipped command. | Every fact in the output (packages, entry points, dependencies, directory counts) must be re-derivable from the same `package.json`/file data by a separate, independent calculation — nothing in the output should require guessing or outside information. |

R1–R6 stay as written — each is either already true by how the code works, or easy to
check by diffing output, and none conflict with each other. One thing worth noting: the
staff interviewee's aside that the tool "could load up a dev container, build script...
build the Dockerfile" (S-10–S-12) pulls against R6 (never build or run anything). That
idea never became a requirement row in the first place, so there's nothing to resolve
here — R6 stays, since three separate interviews independently said the tool should
stay read-only (S-1, C-1, O-1), and the build-script idea was one aside from one person.

## Properties written this round

Four properties in `packages/core/test/tool-walkthrough-analysis.property.test.ts`,
covering all four kinds:

1. **R2 — Invariant.** Generates random sets of workspace packages with random
   dependency edges (some real, some external). Checks that every real package shows up
   and every listed dependency is both real and actually declared.
2. **R3 — Model/oracle.** Recounts top-level file counts a second, independent way
   (a plain loop that skips `node_modules`) and checks it against the tool's own count.
3. **R4 — Round-trip.** Runs the tool, adds a package, removes it again, and checks the
   output comes back byte-for-byte identical, with no trace of the removed package.
4. **R5 — Metamorphic.** Adds one file with a name that can never match an entry point,
   inside an existing package's `src/` folder, and checks that only that one directory's
   count changes — everything else in the output stays identical.

Generator choices are explained in comments in the test file.

## Step 3: Run, Triage, Fix

The R4 property failed twice — both times on a wrong test, not a tool bug.

1. First (seed 764158364): generated package `a0`, extra package named `ck`. `ck` turned
   out to be a substring of the word "packages", which appears in every output
   regardless of what's added or removed. Fixed by checking for the full scoped package
   name (`@acme/ck`) instead of the bare random string.
2. That fix wasn't enough — CI caught a second case (seed -602322490): packages `e3a`
   and `aa`, extra package named `e3`. `@acme/e3` is a literal prefix of the real,
   untouched package `@acme/e3a`, so even the scoped-name substring check false-matched.
   Fixed properly this time: instead of searching the rendered text at all, the test now
   checks exact membership in the parsed package list (`overview.packages.map(p =>
   p.name)`), which can't collide on prefixes the way string matching can.

Verified the fix against both recorded counterexamples directly, then ran the test file
20 times in a row with no failures, then the full `packages/core` suite (1104 tests,
0 failures).
