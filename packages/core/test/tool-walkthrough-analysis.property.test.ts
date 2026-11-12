import { describe, test, expect } from "bun:test"
import fc from "fast-check"
import { WalkthroughAnalysis } from "@opencode-ai/core/tool/walkthrough-analysis"

// Fixed for Stryker (P5): a mutant must be killed or survive the same way on every run,
// not depending on which random inputs fast-check happens to pick that time.
fc.configureGlobal({ seed: 42 })

const json = (value: unknown) => JSON.stringify(value)

/**
 * Generator choices:
 *
 * `nameArb` produces short lowercase identifiers only — real package names, not random
 * strings — so every generated package.json is syntactically valid and the generator
 * reaches the cases interviewees actually described (sibling workspace packages that
 * depend on each other, plus "noise" from node_modules and external deps).
 *
 * `pkgsArb` generates 1-5 *unique-named* packages, then gives each one a random subset of
 * the *other* generated packages as workspace dependencies (so "hallucinated" dependency
 * edges can never occur by construction — any hallucination we catch is a real tool bug)
 * plus an optional external dependency drawn from a small fixed pool. This is the
 * boundary R2 and R3 care about: can the tool tell a real sibling package apart from an
 * external one, and does it miss any real package.
 *
 * `fc.nat({ max })` for node_modules noise reaches zero (the common case) and several
 * noisy entries, which is the boundary R3 (node_modules exclusion) cares about.
 */

interface PkgSpec {
  dir: string
  name: string
  selfDeps: string[]
  external?: string
}

const nameArb = fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/)

const pkgsArb: fc.Arbitrary<PkgSpec[]> = fc
  .uniqueArray(nameArb, { minLength: 1, maxLength: 5 })
  .chain((names) =>
    fc.tuple(
      ...names.map((name) =>
        fc.record({
          dir: fc.constant(name),
          name: fc.constant(`@acme/${name}`),
          selfDeps: fc.subarray(
            names.filter((other) => other !== name).map((other) => `@acme/${other}`),
          ),
          external: fc.option(fc.constantFrom("left-pad", "zod", "chalk"), { nil: undefined }),
        }),
      ),
    ),
  )

const buildSnapshot = (pkgs: PkgSpec[], nodeModulesNoise: number): WalkthroughAnalysis.Snapshot => {
  const files: string[] = ["package.json", "README.md"]
  const contents: Record<string, string> = {
    "package.json": json({ name: "acme", workspaces: ["packages/*"] }),
    "README.md": "# Acme",
  }
  for (const pkg of pkgs) {
    const manifestPath = `packages/${pkg.dir}/package.json`
    files.push(manifestPath, `packages/${pkg.dir}/src/index.ts`)
    const dependencies: Record<string, string> = {}
    for (const dep of pkg.selfDeps) dependencies[dep] = "workspace:*"
    if (pkg.external) dependencies[pkg.external] = "1.0.0"
    contents[manifestPath] = json({ name: pkg.name, dependencies })
  }
  for (let i = 0; i < nodeModulesNoise; i++) {
    files.push(`node_modules/noise-${i}/package.json`)
    contents[`node_modules/noise-${i}/package.json`] = json({ name: `noise-${i}` })
  }
  return { files, contents }
}

describe("tool.walkthrough properties", () => {
  // R2: The tool must never list a package or dependency that isn't declared in some
  // package.json, and must never omit a workspace package that has a valid manifest.
  // Kind: invariant
  test("R2: every real package appears, and every listed dependency is real (never hallucinated)", () => {
    fc.assert(
      fc.property(pkgsArb, fc.nat({ max: 4 }), (specs, noise) => {
        const snapshot = buildSnapshot(specs, noise)
        const overview = WalkthroughAnalysis.analyze(snapshot)
        const rendered = WalkthroughAnalysis.render(overview)
        const realNames = new Set(specs.map((spec) => spec.name))

        expect(new Set(overview.packages.map((pkg) => pkg.name))).toEqual(realNames)

        for (const pkg of overview.packages) {
          const spec = specs.find((s) => s.name === pkg.name)!
          for (const dep of pkg.dependsOn) {
            expect(realNames.has(dep)).toBe(true)
            expect(spec.selfDeps).toContain(dep)
          }
          // The rendered line must match the structured data exactly.
          if (pkg.dependsOn.length > 0) expect(rendered).toContain(`  depends on: ${pkg.dependsOn.join(", ")}`)
        }
        // And it must appear exactly as often as packages that actually have a dependency —
        // not more (a stray line) and not fewer (a dropped one).
        const expectedLines = overview.packages.filter((pkg) => pkg.dependsOn.length > 0).length
        expect(rendered.split("\n").filter((line) => line.startsWith("  depends on:")).length).toBe(expectedLines)
      }),
    )
  })

  // R3: Top-level directory file counts must not include files under any node_modules.
  // Kind: model/oracle (compared against an independent reference recount)
  test("R3: top-level counts match an independent recount that excludes node_modules", () => {
    fc.assert(
      fc.property(pkgsArb, fc.nat({ max: 6 }), (specs, noise) => {
        const snapshot = buildSnapshot(specs, noise)
        const overview = WalkthroughAnalysis.analyze(snapshot)

        const expected = new Map<string, number>()
        for (const file of snapshot.files) {
          if (file.split("/").includes("node_modules")) continue
          const slash = file.indexOf("/")
          if (slash <= 0) continue
          const top = file.slice(0, slash)
          expected.set(top, (expected.get(top) ?? 0) + 1)
        }

        expect(new Map(overview.topLevel.map((entry) => [entry.path, entry.files]))).toEqual(expected)
      }),
    )
  })

  // R4: Running the tool, adding a package, running again, deleting that package, then
  // running a third time must produce output identical to the first run, with no trace
  // of the deleted package anywhere.
  // Kind: round-trip
  test("R4: adding then deleting a package returns to the original summary", () => {
    fc.assert(
      fc.property(pkgsArb, fc.nat({ max: 4 }), nameArb, (specs, noise, extraName) => {
        fc.pre(!specs.some((spec) => spec.dir === extraName))

        const before = buildSnapshot(specs, noise)
        const originalOutput = WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(before))

        const extraPackageName = `@acme/${extraName}`
        const withExtra = buildSnapshot([...specs, { dir: extraName, name: extraPackageName, selfDeps: [] }], noise)
        const addedOverview = WalkthroughAnalysis.analyze(withExtra)
        // sanity: adding it really did change the output. Checked by exact name match
        // against the parsed package list, not a text/substring search — two random
        // short names can be prefixes of each other (e.g. "e3" and "e3a"), which made a
        // substring check on the rendered text false-positive both ways.
        expect(addedOverview.packages.map((pkg) => pkg.name)).toContain(extraPackageName)

        const after = buildSnapshot(specs, noise) // "delete" = rebuild without the extra package
        const afterOverview = WalkthroughAnalysis.analyze(after)
        const afterOutput = WalkthroughAnalysis.render(afterOverview)

        expect(afterOutput).toBe(originalOutput)
        expect(afterOverview.packages.map((pkg) => pkg.name)).not.toContain(extraPackageName)
      }),
    )
  })

  // R5: Adding one file inside a package's src folder must change only that package's
  // entry-point line and its top-level directory's file count — every other package,
  // dependency line, and doc list stays identical, unless the new file is itself an
  // entry point named in package.json.
  // Kind: metamorphic
  test("R5: one new non-entry file under a package's src/ changes only that top-level directory's count", () => {
    fc.assert(
      fc.property(pkgsArb, fc.nat({ max: 4 }), (specs, noise) => {
        fc.pre(specs.length > 0)

        const before = buildSnapshot(specs, noise)
        const overviewBefore = WalkthroughAnalysis.analyze(before)

        const target = specs[0]
        // "extra-<n>.ts" never matches the entry-point candidates (src/index.*, src/main.*),
        // so this file can never itself become an entry point — isolating the metamorphic
        // change to the file count alone.
        const extraFile = `packages/${target.dir}/src/extra-${noise}.ts`
        const after = { files: [...before.files, extraFile], contents: before.contents }
        const overviewAfter = WalkthroughAnalysis.analyze(after)

        expect(overviewAfter.packages).toEqual(overviewBefore.packages)
        expect(overviewAfter.docs).toEqual(overviewBefore.docs)
        expect(overviewAfter.name).toBe(overviewBefore.name)

        const beforeCounts = new Map(overviewBefore.topLevel.map((entry) => [entry.path, entry.files]))
        const afterCounts = new Map(overviewAfter.topLevel.map((entry) => [entry.path, entry.files]))
        const changed = [...afterCounts.keys()].filter(
          (key) => afterCounts.get(key) !== (beforeCounts.get(key) ?? 0),
        )

        expect(changed).toEqual(["packages"])
        expect(afterCounts.get("packages")).toBe((beforeCounts.get("packages") ?? 0) + 1)
      }),
    )
  })

  // R7 (revised): every fact in the output must be independently re-derivable from the
  // manifest data, not just the package/dependency names R2-R5 already cover. This closes
  // a real gap found via Stryker (P5): the original generator never varied bin/main/module/
  // exports, so entryPoints()'s own formatting logic, and render()'s "entry:"/"depends on:"
  // lines, were never exercised by anything — a mutant there had nothing to disagree with.
  //
  // Generator choices: each package independently gets 0-1 of {string bin, object bin},
  // an optional main, an optional module, and 0-1 of {string exports, object exports with
  // 1-8 subpaths} — covering every branch entryPoints() has, including the ">5 exports"
  // truncation. "src: src/index.ts" is always present too, since buildSnapshot always
  // writes that file; the oracle below replicates that ordering exactly.
  // Kind: model/oracle
  test("R7: entry points and dependency lines are independently re-derivable from the manifest", () => {
    const binArb = fc.option(
      fc.oneof(
        fc.webUrl().map((bin) => ({ kind: "string" as const, bin })),
        fc
          .dictionary(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), fc.webUrl(), { minKeys: 1, maxKeys: 3 })
          .map((bin) => ({ kind: "object" as const, bin })),
      ),
      { nil: undefined },
    )
    const exportsArb = fc.option(
      fc.oneof(
        fc.webUrl().map((exports) => ({ kind: "string" as const, exports })),
        fc
          .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { minLength: 1, maxLength: 8 })
          .map((keys) => ({ kind: "object" as const, exports: Object.fromEntries(keys.map((k) => [`./${k}`, `./${k}.ts`])) })),
      ),
      { nil: undefined },
    )

    fc.assert(
      fc.property(
        nameArb,
        binArb,
        fc.option(fc.webUrl(), { nil: undefined }),
        fc.option(fc.webUrl(), { nil: undefined }),
        exportsArb,
        (pkgName, bin, main, moduleField, exportsField) => {
          const manifest: Record<string, unknown> = { name: `@acme/${pkgName}` }
          if (bin) manifest.bin = bin.kind === "string" ? bin.bin : bin.bin
          if (main) manifest.main = main
          if (moduleField) manifest.module = moduleField
          if (exportsField) manifest.exports = exportsField.kind === "string" ? exportsField.exports : exportsField.exports

          const snapshot = buildSnapshot([{ dir: pkgName, name: `@acme/${pkgName}`, selfDeps: [] }], 0)
          // Overwrite the manifest buildSnapshot wrote with one that has the richer fields.
          snapshot.contents[`packages/${pkgName}/package.json`] = json(manifest)

          const overview = WalkthroughAnalysis.analyze(snapshot)
          const pkg = overview.packages[0]

          // Independent oracle: replicate entryPoints()'s own documented ordering
          // (bin, main, module, exports-string, exports-subpaths, src) without calling it.
          const expected: string[] = []
          if (bin?.kind === "string") expected.push(`bin: @acme/${pkgName} -> ${bin.bin}`)
          else if (bin?.kind === "object") for (const [k, v] of Object.entries(bin.bin)) expected.push(`bin: ${k} -> ${v}`)
          if (main) expected.push(`main: ${main}`)
          if (moduleField) expected.push(`module: ${moduleField}`)
          if (exportsField?.kind === "string") expected.push(`exports: ${exportsField.exports}`)
          else if (exportsField?.kind === "object") {
            const subpaths = Object.keys(exportsField.exports)
            const shown = subpaths.slice(0, 5)
            const more = subpaths.length - 5
            expected.push(`exports: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`)
          }
          expected.push("src: src/index.ts")

          expect(pkg.entryPoints).toEqual(expected)

          // The rendered text must carry the exact same facts, joined the same way a
          // person actually reads them — not just the structured object.
          const rendered = WalkthroughAnalysis.render(overview)
          expect(rendered).toContain(`  entry: ${expected.join("; ")}`)
        },
      ),
      { numRuns: 200 },
    )
  })

  // R2/R7: with no real packages at all, the output must say so plainly, and the
  // "## Top-level directories" section must appear exactly when there's something to
  // show — not an artifact of whatever happened to be in the one fixture repo used
  // elsewhere. Kind: invariant (closes the last Stryker survivors in render()'s fallback
  // branches, which the other properties never reach since they always generate >=1
  // package and >=1 top-level directory).
  test("R2/R7: a repo with no real packages always says so, and lists top-level directories only when there are any", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/), { minLength: 0, maxLength: 3 }),
        fc.boolean(),
        (topDirs, hasReadme) => {
          const files = hasReadme ? ["README.md"] : []
          const contents: Record<string, string> = hasReadme ? { "README.md": "# hi" } : {}
          for (const dir of topDirs) files.push(`${dir}/a.txt`)
          // No package.json anywhere, so there can be no workspace packages to find.

          const overview = WalkthroughAnalysis.analyze({ files, contents })
          const rendered = WalkthroughAnalysis.render(overview)

          expect(overview.packages).toEqual([])
          expect(rendered).toContain("No packages detected from package.json files; showing directory layout only.")
          expect(rendered).not.toContain("## Packages")

          if (topDirs.length === 0) {
            expect(rendered).not.toContain("## Top-level directories")
          } else {
            expect(rendered).toContain("## Top-level directories")
            for (const dir of topDirs) expect(rendered).toContain(`- ${dir}/ (1 files)`)
          }
        },
      ),
    )
  })
})
