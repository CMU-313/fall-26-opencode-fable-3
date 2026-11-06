import { describe, test, expect } from "bun:test"
import fc from "fast-check"
import { WalkthroughAnalysis } from "@opencode-ai/core/tool/walkthrough-analysis"

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
        const realNames = new Set(specs.map((spec) => spec.name))

        expect(new Set(overview.packages.map((pkg) => pkg.name))).toEqual(realNames)

        for (const pkg of overview.packages) {
          const spec = specs.find((s) => s.name === pkg.name)!
          for (const dep of pkg.dependsOn) {
            expect(realNames.has(dep)).toBe(true)
            expect(spec.selfDeps).toContain(dep)
          }
        }
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

        const withExtra = buildSnapshot(
          [...specs, { dir: extraName, name: `@acme/${extraName}`, selfDeps: [] }],
          noise,
        )
        // Check for the full scoped package name, not the bare extraName — a short
        // random identifier (e.g. "ck") can land inside an unrelated word already in
        // the output (e.g. "packages"), which made this check false-positive.
        const extraPackageName = `@acme/${extraName}`
        const addedOutput = WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(withExtra))
        expect(addedOutput).toContain(extraPackageName) // sanity: adding it really did change the output

        const after = buildSnapshot(specs, noise) // "delete" = rebuild without the extra package
        const afterOutput = WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(after))

        expect(afterOutput).toBe(originalOutput)
        expect(afterOutput).not.toContain(extraPackageName)
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
})
