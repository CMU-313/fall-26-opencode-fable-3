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

## Stryker comparison

### Setup

My config is [`packages/core/stryker.ddemammo.config.json`](/packages/core/stryker.ddemammo.config.json).
It uses the `command` runner to run only my property file (`bun test
test/tool-walkthrough-analysis.property.test.ts`), and mutates three ranges of
`src/tool/walkthrough-analysis.ts` — `39-84` (the small helpers, `parse`, and
`packageDirs`), `96-117` (`entryPoints`), and `130-191` (`analyze` and `render`) — which
together are every function my properties actually call. I left out `1-37` (type/schema
declarations, nothing to mutate), `86-94` (`excerpt`, used only for README-based
descriptions, which none of my properties touch), and `118-128` (`wanted`, which is only
called by the real tool wrapper, not by my pure-function tests). I fixed the fast-check
**seed to 42** with `fc.configureGlobal({ seed: 42 })` at the top of the property file.

My feature's pure logic lives in `packages/core`, not `packages/opencode` (where the
team's shared Stryker dependency was added for P5), so I added
`@stryker-mutator/core@10.1.1` to `packages/core` myself — no one else on the team needed
it there. Each run took 7–33 seconds; no `incremental` mode or chunking was needed at this
scope.

Reports: [`mutants/ddemammo/mutation-before-strengthening.html`](/mutants/ddemammo/mutation-before-strengthening.html)
and [`mutants/ddemammo/mutation.html`](/mutants/ddemammo/mutation.html) (final).

| Run | Mutants | Killed | Survived | Score (Stryker) |
| --- | --- | --- | --- | --- |
| Before strengthening (4 properties) | 244 | 86 | 158 | 35.25% |
| After strengthening (6 properties) | 244 | 160 | 84 | **65.57%** |

### Which of my hand-written mutants did Stryker never generate? Why not?

H4 and H5 live in `packages/opencode/src/tool/walkthrough.ts`, a different package
entirely — Stryker only mutates the file ranges I gave it inside `packages/core`, so it
can't reach either one.

H1 removes a condition (`&& names.has(dep)`) from an existing filter. Stryker did
generate something adjacent to this — dropping the whole `.filter(...)` call, or negating
the `dep !== name` half — but never the exact "drop just the second half of an `&&`"
shape, since that specific clause only appears once and Stryker's operator mutators work
on whole conditions, not sub-clauses independently combined the way I removed one by hand.

H2 and H3 are both about *which* check is used (`.includes()` vs `[0] ===`, exact `Set.has`
vs `.some(startsWith)`) rather than changing an operator or literal in otherwise-identical
code — Stryker's mutators rewrite existing expressions, they don't swap one API/algorithm
for a different one that happens to behave almost the same. Neither of those appeared.

### Which Stryker survivors would I never have thought of? Are any of them plausible bugs?

- **The `dependsOn` filter without `.sort()`** (`[...new Set(dependencies)].filter(...)`
  with `.sort()` dropped): genuinely plausible — someone "simplifies" the line and forgets
  sorting was load-bearing for a stable, diffable walkthrough output. It survives because
  my R2 property only checks *membership* (`toContain`), never the order.
- **`topLevel` and `packages` losing their own `.sort(...)` calls** (same shape, two
  different places): same realistic slip, same reason it survives — nothing of mine
  checks output *order*, only output *contents*.
- **Dropping the `description` field entirely** (`...(description ? { description } : {})`
  → always `{}`): a very plausible bug (an accidental `{}` instead of `{ description }`
  during a refactor), and I never noticed it survives until Stryker pointed at it — none
  of my 5 requirements from P3/P4 say anything about per-package descriptions, so nothing
  of mine was ever going to catch this.
- **Dropping the repository name field** (`...(name ? { name } : {})` → always `{}`): same
  shape, same realistic slip. More interesting: even my *round-trip* and *metamorphic*
  properties don't catch it, because they only check that two runs agree with each other,
  not that either run's `name` is actually correct against the real `package.json`.

### What does each approach find that the other doesn't?

My hand-written mutants came straight from my interview-derived requirements, so each one
has a clear "why" tied to what a real user said (H1 → "never hallucinate a dependency",
H2 → "exclude `node_modules`", H3 → "only the file count should change"). They could also
reach into a different *package* entirely (H4, H5 in the live tool wrapper), which Stryker
structurally cannot do since it only mutates the file ranges I point it at.

Stryker was far more exhaustive inside the one file it could reach: it tried every
operator, boundary, and literal, and found real gaps I hadn't thought to test by hand —
the two dropped-`.sort()` cases and the two dropped-field cases above are all things a
real PR reviewer could plausibly miss, and none of them trace back to anything a specific
interviewee said. The cost is volume: 84 survivors remain, and most of them are things my
generators simply never reach (see Equivalent mutants, below) rather than things Stryker
"found" in any deep sense — a lot of its output is "I changed an operator in code your
test never drives with an input where it matters."

### Strengthening

All improvements below were made by strengthening properties, not by adding example-based
tests.

- **New property, R7 (model/oracle):** `entryPoints()` was never exercised on `bin`,
  `main`, `module`, or `exports` at all — my original generator only ever created a plain
  `src/index.ts` package. The new property generates all four fields (including the
  >5-subpath truncation case) and checks the result against an independent
  recomputation of `entryPoints()`'s own documented ordering, *and* checks the rendered
  `entry:` line matches. This single property killed most of the survivors in lines
  96–117 and the `entry:`-line survivors in `render()`.
- **New property, R2/R7 (invariant):** a repo with zero real packages and 0–3 unrelated
  top-level directories, checking the "No packages detected" fallback text and that the
  "## Top-level directories" section appears exactly when there's something to show. This
  killed the `render()` survivors in its empty-repo and empty-topLevel branches (lines
  ~183–190), which none of the other properties ever reached (they always generate ≥1
  package and ≥1 top-level directory).
- **Strengthened, R2 (invariant):** added a check that the rendered `depends on:` line
  appears exactly as often as packages with a non-empty `dependsOn`, and that its text
  matches the structured array exactly — not just that the structured data was right.
  This killed the remaining `dependsOn.length > 0` / `depends on:`-line survivors in
  `render()`.

Re-running the hand-written mutants against the strengthened file doesn't change their
results: H1 is still killed, H2–H5 still survive for the same reasons recorded above (none
of this strengthening touched `node_modules` handling, entry-point *file matching*, or the
wrapper tools).

### Equivalent mutants

I did not find any mutant I could confidently argue is truly equivalent — meaning its
change can *never* be observed by any possible test, not just by mine. This analyzer has
very little redundant or dead logic (unlike, say, schema-validation code that often
double-checks something already guaranteed upstream); nearly every surviving condition,
optional spread, or filter corresponds to a real branch that *could* produce a different
answer for some input, including ones outside what my generators currently produce.

Instead, every survivor I looked at traces to one of these concrete, closeable gaps:

- **Generator narrowness.** My generators never produce: a non-object root manifest
  (a bare array or string as the whole `package.json`), a workspace glob with `!`
  negation or more than one path segment, a package name or export key containing regex
  special characters, or out-of-natural-order packages/exports/directories (so every
  `.sort()` removal is unobservable purely by luck of generation order, not by
  equivalence).
- **Assertion narrowness.** Nothing of mine checks a package's `description`, the
  repository `name` field's actual *value* (only that it's consistent across two runs),
  or output *order* (only output *membership*).

Given that, I'm reporting the same score both ways rather than guessing at equivalence I
can't actually defend:

**Final score: 65.57% (160/244), both as Stryker reports it and with 0 equivalent mutants
excluded.** The honest path to a higher score here is a richer generator and a few more
oracle-style assertions (both named above), not an equivalence argument.

## Agent failure case

None of my existing properties came from asking opencode directly (I wrote all of
R2–R7 myself, in Claude Code), so I followed the assignment's fallback: I asked the real
`opencode` CLI, running with my own Anthropic credentials, to write a property for R6,
which had no property at all before this.

### Transcript excerpt

**My prompt** (via `bun run --conditions=browser packages/opencode/src/index.ts run`,
model `claude-sonnet-5-5`):

> Write one fast-check property-based test for this requirement of the walkthrough tool
> (packages/core/src/tool/walkthrough-analysis.ts):
>
> R6: The tool must never run install, build, or lifecycle scripts found in any
> package.json. Acceptance criteria: Add a postinstall script that writes a marker file;
> run walkthrough; the marker file does not exist afterward.
>
> Put it in a new file packages/core/test/tool-walkthrough-analysis.agent.property.test.ts.
> Use bun:test and fast-check, following the same style as the existing
> packages/core/test/tool-walkthrough-analysis.property.test.ts (same import of
> WalkthroughAnalysis, same json() helper pattern). Add fc.configureGlobal({ seed: 42 }) at
> the top. Don't change any other files.

**opencode's response:** it created
[`packages/core/test/tool-walkthrough-analysis.agent.property.test.ts`](/packages/core/test/tool-walkthrough-analysis.agent.property.test.ts)
with this property (abridged; full file is in the repo):

```ts
fc.configureGlobal({ seed: 42 })
// ...
describe("tool.walkthrough properties (agent)", () => {
  test("R6: no install, build, or lifecycle script in any package.json is ever executed", () => {
    // ... builds package.json manifests whose "scripts" fields are real shell commands
    // that create marker files ...
    const snapshot = { files, contents }
    WalkthroughAnalysis.wanted(files)
    WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(snapshot))

    expect(markers.length).toBeGreaterThan(0)
    expect(markers.filter((marker) => existsSync(marker))).toEqual([])
  })
})
```

It ran the test (`1 pass, 0 fail, 201 expect() calls`) and finished successfully.

### The mutant it let survive

This property calls `WalkthroughAnalysis.analyze`/`.render` directly on an in-memory
snapshot object it builds itself — never the real tool wrapper
(`packages/core/src/tool/walkthrough.ts` or
`packages/opencode/src/tool/walkthrough.ts`) that actually reads files from disk and is
the only place a script could ever be executed. I confirmed this concretely: I wrote the
same kind of mutant as my hand-written H5 (a "helpful" addition that runs a package's
`postinstall` script via `Bun.spawnSync` before analyzing — this one in
`packages/core/src/tool/walkthrough.ts`, saved as
[`mutants/ddemammo/agent-case/postinstall.patch`](/mutants/ddemammo/agent-case/postinstall.patch))
and ran opencode's property against it: **1 pass, 0 fail — identical to the unmutated
code.** The property cannot tell the difference, because it never calls the mutated code
at all.

### Why the property was too weak

This is the "always-passing property" failure mode named in the assignment, in a
specific shape: the assertion doesn't restate the implementation so much as it tests a
*different* implementation than the one with the bug. `WalkthroughAnalysis.analyze` is a
pure function over data already in memory — it has no filesystem access and no way to
spawn a process, so a property that only calls it is guaranteed to pass no matter what a
real tool wrapper does. No generator or assertion fix within that function can repair
this; the property has to call code that can actually violate R6.

### Strengthened version

I replaced it with
[`packages/core/test/tool-walkthrough.agent.property.test.ts`](/packages/core/test/tool-walkthrough.agent.property.test.ts),
which drives the real `WalkthroughTool` (packages/core) against a real temp directory,
using the same harness `tool-walkthrough.test.ts`'s own "live" fixture test already
uses. Each generated case writes a real `package.json` whose `scripts` include
`postinstall` (what R6's acceptance criteria names) plus a random subset of other real
npm/bun lifecycle script names, each one a real shell command that touches a marker file
on disk, then runs the real tool and checks the marker is absent.

I initially tried this against the `packages/opencode` wrapper (where H4/H5 live)
reusing its existing fixture harness, and hit a real confound worth recording: that
harness's project bootstrap runs a genuine `npm install` in the test directory
(`packages/opencode/src/config/config.ts`, gated by `Flag.OPENCODE_PURE` — see
`TESTING.md`'s own warning about this), which — independent of anything the walkthrough
tool does — executes the test project's own `preinstall`/`install`/`postinstall`
scripts as an ordinary, correct side effect of a real install. That made "did
walkthrough run this, or did something else entirely" impossible to isolate there, even
with `OPENCODE_PURE=1` set. I moved the strengthened test to `packages/core`'s wrapper
and its lighter "live" harness instead (`tempLocationLayer`: a plain temp directory, no
project bootstrap at all), and wrote an equivalent mutant there to verify it.

### Evidence it kills the mutant

- **Unmutated code:** 8/8 cases pass.
- **With the postinstall mutant applied** (`mutants/ddemammo/agent-case/postinstall.patch`):
  **8/8 cases fail** — every generated case's marker file exists after the tool runs,
  exactly where opencode's original property showed no difference at all.
