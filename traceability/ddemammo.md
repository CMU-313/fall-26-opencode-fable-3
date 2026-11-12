# Traceability — ddemammo

Target feature: `walkthrough` tool (issue #23). See `UserGuide.md` and
`packages/core/src/tool/walkthrough-analysis.ts`.

## Step 1: Requirements Review

All seven Project 3 requirements, with their original interview evidence. Six are kept
as written. R7 is revised below.

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property | Kind | Test | Mutants it kills |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | S-1, C-1, O-1 | The tool must never modify, create, or delete any file in the analyzed repository. | Hash every file before running `walkthrough`, run it, hash again — same hashes, no new or missing files. | No | — (see note below) | — | — | None (no property; H4 was aimed here but reaches no test of mine) |
| R2 | C-2, C-3 | The tool must never list a package or dependency that isn't declared in some `package.json`, and must never skip a real workspace package. | On a fixture repo, the output never contains a package or dependency name that isn't in any `package.json`; every workspace directory with a valid manifest shows up in `## Packages`. | No | "every real package appears, and every listed dependency is real" | Invariant | `packages/core/test/tool-walkthrough-analysis.property.test.ts` | H1 |
| R3 | C-4 | File counts must not include anything under `node_modules`. | A repo with a large `node_modules` shows the real directory counts, with `node_modules` excluded. | No | "top-level counts match an independent recount that excludes node_modules" | Model/oracle | `packages/core/test/tool-walkthrough-analysis.property.test.ts` | None (H2 survived; see Strengthening) |
| R4 | S-3, S-4, C-5, C-6, O-3 | Add a package, run the tool, delete the package, run it again — the second run must match the first exactly, with no trace of the deleted package. | output₁ on a fixture repo; add a package, output₂ differs; delete it, output₃ equals output₁ byte for byte. | No | "adding then deleting a package returns to the original summary" | Round-trip | `packages/core/test/tool-walkthrough-analysis.property.test.ts` | None (no hand-written mutant targeted this one) |
| R5 | S-5, S-6, C-7, C-8, C-9, O-5 | Adding one file inside a package's `src` folder should only change that package's entry line and its directory count — nothing else moves, unless the new file is itself named as an entry point in `package.json`. | Add a non-entry file to `packages/api/src/`; only `@acme/api`'s directory count changes in the output. | No | "one new non-entry file under a package's src/ changes only that top-level directory's count" | Metamorphic | `packages/core/test/tool-walkthrough-analysis.property.test.ts` | None (H3 survived; see Strengthening) |
| R6 | S-2 | The tool must never run install, build, or lifecycle scripts from any `package.json`. | Add a `postinstall` script that writes a marker file; run `walkthrough`; the marker file never appears. | No | — (see note below) | — | — | None (no property; H5 reaches no test of mine) |
| R7 | S-7, S-8, C-10, C-11, O-6, O-7 | *(revised — see below)* | *(revised — see below)* | **Yes** | R3's property already does what this one asks for | Model/oracle | `packages/core/test/tool-walkthrough-analysis.property.test.ts` | None |

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

## Hand-written mutants

Patches are in [`mutants/ddemammo/`](/mutants/ddemammo/). Each one was made by editing
the source, saving `git diff` as the patch, and reverting (`git checkout --`). To run one:
`git apply mutants/ddemammo/H<n>.patch`, run the relevant tests below, then
`git checkout -- <file>` to revert. All properties pass on the unmodified code.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
| --- | --- | --- | --- | --- |
| H1 | R2 | `walkthrough-analysis.ts`: `dependsOn` drops the `names.has(dep)` check, so an external dependency (e.g. `zod`, `left-pad`) is listed as a workspace dependency alongside real ones | "Every real package appears, and every listed dependency is real" (R2), which asserts `realNames.has(dep)` for every entry | **Killed** on the 1st run. Counterexample: package `aa` with external dep `left-pad` — `left-pad` showed up in `dependsOn` |
| H2 | R3 | `walkthrough-analysis.ts`: `inNodeModules` checks only `file.split("/")[0] === "node_modules"` instead of `.includes("node_modules")`, so a *nested* `node_modules` (e.g. `packages/foo/node_modules/...`) is no longer excluded from file counts | "Top-level counts match an independent recount that excludes node_modules" (R3) — but only if the generator ever places `node_modules` noise below the top level | **Survived** (checked 6 runs). My generator only ever writes `node_modules/noise-N/package.json` at the repo root, never nested inside a package directory, so this boundary is never reached |
| H3 | R5 | `walkthrough-analysis.ts`: the entry-point file lookup changes from an exact `Set.has` match to `files.some(f => f.startsWith(...))`, a prefix match instead of an exact one | "One new non-entry file under a package's src/ changes only that top-level directory's count" (R5) — but only if the generated extra file name is itself a prefix-extension of `index`/`main` | **Survived** (checked 3 runs). My generator's extra files are named `src/extra-N.ts`, which isn't a prefix match for `src/index.ts`/`src/main.ts` either way, so exact-match and prefix-match behave identically here |
| H4 | R1 | `packages/opencode/src/tool/walkthrough.ts` (the live tool wrapper): adds a "helpful" cache write of the computed overview to `.opencode/walkthrough-cache.json` after every run | None — my property file only imports the pure `WalkthroughAnalysis` module and never exercises this wrapper at all | **Survived** against my properties, exactly as predicted (they can't reach this file). It did crash 3 of the 17 pre-existing fixture tests in `packages/opencode/test/tool/walkthrough.test.ts` with `ENOENT`, but only because those fixtures' temp directories don't contain a `.opencode` folder for the write to land in — an accidental crash, not a real check of "never writes a file". A fixture repo that already has a `.opencode/` folder would let this mutant pass silently |
| H5 | R6 | `packages/opencode/src/tool/walkthrough.ts`: if the root `package.json` has a `scripts.postinstall`, runs it via `Bun.spawnSync` before analyzing | None — same reason as H4, plus no existing fixture repo happens to declare a `postinstall` script | **Survived** cleanly: all 20 existing wrapper tests still pass, since the mutated branch never fires on any fixture |

**Result:** 1 of 5 killed (H1), and all 5 predictions were correct, including the 4
survivors. Three different root causes showed up: a generator that never reaches a real
boundary (H2, H3), and a requirement with no property at all because the behavior lives
in code my properties don't touch (H4, H5). H2 and H3 are addressed in Strengthening,
below. H4 and H5 are a real, separate finding: R1 and R6 are both, in the end, properties
of the *wrapper* tools (`packages/core/src/tool/walkthrough.ts` and
`packages/opencode/src/tool/walkthrough.ts`), not of the pure analyzer my property suite
targets, and nothing in this project currently tests either of them with generated input.
