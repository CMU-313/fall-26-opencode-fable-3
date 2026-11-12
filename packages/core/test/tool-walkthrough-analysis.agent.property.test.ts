import { afterAll, describe, test, expect } from "bun:test"
import fc from "fast-check"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WalkthroughAnalysis } from "@opencode-ai/core/tool/walkthrough-analysis"

fc.configureGlobal({ seed: 42 })

const json = (value: unknown) => JSON.stringify(value)

/**
 * Generator choices:
 *
 * `scriptsArb` picks a non-empty subset of the install, build and lifecycle script names npm/bun
 * would run automatically or on request (preinstall/install/postinstall, prepare, prepack,
 * build, ...). Every chosen script is a real shell command that creates a marker file, so if
 * the tool ever executed any of them the marker would appear on disk. `minLength: 1` guarantees
 * each run has at least one script that could fire.
 *
 * The scripts are placed in the root manifest and in 1-3 workspace package manifests
 * (independently chosen), so the property covers both places the tool reads package.json from.
 */

const markerDir = mkdtempSync(path.join(tmpdir(), "walkthrough-r6-"))
afterAll(() => rmSync(markerDir, { recursive: true, force: true }))

const scriptNames = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublishOnly", "build"]
const nameArb = fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/)
const scriptsArb = fc.subarray(scriptNames, { minLength: 1 })

describe("tool.walkthrough properties (agent)", () => {
  // R6: The tool must never run install, build, or lifecycle scripts found in any package.json.
  // Kind: invariant (a side-effect marker file must not exist after the tool runs)
  test("R6: no install, build, or lifecycle script in any package.json is ever executed", () => {
    // Sanity check on the oracle: the marker command really does create a file when run, so
    // "marker absent" below can only mean the script was never executed.
    const sanityMarker = path.join(markerDir, "sanity")
    Bun.spawnSync(["sh", "-c", `touch "${sanityMarker}"`])
    expect(existsSync(sanityMarker)).toBe(true)

    let run = 0
    fc.assert(
      fc.property(
        fc.uniqueArray(nameArb, { minLength: 1, maxLength: 3 }),
        scriptsArb,
        fc.array(scriptsArb, { minLength: 3, maxLength: 3 }),
        (names, rootScripts, packageScripts) => {
          run++
          const markers: string[] = []
          const scriptsFor = (owner: string, selected: string[]) =>
            Object.fromEntries(
              selected.map((script) => {
                const marker = path.join(markerDir, `${run}-${owner}-${script}`)
                markers.push(marker)
                return [script, `touch "${marker}"`]
              }),
            )

          const files = ["package.json", "README.md"]
          const contents: Record<string, string> = {
            "package.json": json({
              name: "acme",
              workspaces: ["packages/*"],
              scripts: scriptsFor("root", rootScripts),
            }),
            "README.md": "# Acme",
          }
          names.forEach((name, index) => {
            files.push(`packages/${name}/package.json`, `packages/${name}/src/index.ts`)
            contents[`packages/${name}/package.json`] = json({
              name: `@acme/${name}`,
              scripts: scriptsFor(name, packageScripts[index]),
            })
          })

          const snapshot = { files, contents }
          WalkthroughAnalysis.wanted(files)
          WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(snapshot))

          expect(markers.length).toBeGreaterThan(0)
          expect(markers.filter((marker) => existsSync(marker))).toEqual([])
        },
      ),
    )
  })
})
