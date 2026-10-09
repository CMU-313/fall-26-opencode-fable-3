import { describe, expect, test } from "bun:test"
import { WalkthroughAnalysis } from "@opencode-ai/core/tool/walkthrough-analysis"

const json = (value: unknown) => JSON.stringify(value)

const snapshot = (tree: Record<string, string>) => ({ files: Object.keys(tree), contents: tree })

const monorepo = {
  "package.json": json({ name: "acme", workspaces: ["packages/*"] }),
  "README.md": "# Acme",
  "AGENTS.md": "# Agents",
  "packages/api/package.json": json({
    name: "@acme/api",
    bin: { acme: "./bin/acme" },
    dependencies: { "@acme/core": "workspace:*", zod: "1.0.0" },
  }),
  "packages/api/src/index.ts": "",
  "packages/core/package.json": json({
    name: "@acme/core",
    description: "Core engine",
    exports: { ".": "./src/index.ts", "./util": "./src/util.ts" },
    dependencies: { "@acme/core": "*" },
  }),
  "packages/web/package.json": json({
    name: "@acme/web",
    main: "dist/index.js",
    devDependencies: { "@acme/api": "*", "@acme/core": "*" },
  }),
  "packages/web/README.md":
    "# Web\n\n[![badge](x)](y)\n\nBrowser client for the Acme API.\nSecond line.\n\nLater paragraph.",
  "examples/demo/package.json": json({ name: "@acme/demo" }),
  "node_modules/left-pad/package.json": json({ name: "left-pad" }),
  "docs/guide.md": "",
}

describe("WalkthroughAnalysis.analyze", () => {
  test("lists only workspace packages, sorted by path", () => {
    const overview = WalkthroughAnalysis.analyze(snapshot(monorepo))
    expect(overview.name).toBe("acme")
    expect(overview.packages.map((pkg) => pkg.path)).toEqual(["packages/api", "packages/core", "packages/web"])
  })

  test("reports bin, main, exports and src entry points", () => {
    const [api, core, web] = WalkthroughAnalysis.analyze(snapshot(monorepo)).packages
    expect(api.entryPoints).toEqual(["bin: acme -> ./bin/acme", "src: src/index.ts"])
    expect(core.entryPoints).toEqual(["exports: ., ./util"])
    expect(web.entryPoints).toEqual(["main: dist/index.js"])
  })

  test("caps long export lists", () => {
    const exports = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`./m${i}`, `./m${i}.ts`]))
    const overview = WalkthroughAnalysis.analyze(snapshot({ "package.json": json({ name: "solo", exports }) }))
    expect(overview.packages[0].entryPoints).toEqual(["exports: ./m0, ./m1, ./m2, ./m3, ./m4 (+3 more)"])
  })

  test("depends on workspace packages only, without self or external dependencies", () => {
    const [api, core, web] = WalkthroughAnalysis.analyze(snapshot(monorepo)).packages
    expect(api.dependsOn).toEqual(["@acme/core"])
    expect(core.dependsOn).toEqual([])
    expect(web.dependsOn).toEqual(["@acme/api", "@acme/core"])
  })

  test("prefers the manifest description, then the first README prose paragraph", () => {
    const [api, core, web] = WalkthroughAnalysis.analyze(snapshot(monorepo)).packages
    expect(core.description).toBe("Core engine")
    expect(web.description).toBe("Browser client for the Acme API. Second line.")
    expect(api.description).toBeUndefined()
  })

  test("skips README lead-in lines that only introduce a list or code block", () => {
    const readme = "# Solo\n\nTo install dependencies:\n\n```sh\nbun i\n```\n\nSmall CLI for parsing logs."
    const overview = WalkthroughAnalysis.analyze(
      snapshot({ "package.json": json({ name: "solo" }), "README.md": readme }),
    )
    expect(overview.packages[0].description).toBe("Small CLI for parsing logs.")
  })

  test("counts top-level directories and finds root docs", () => {
    const overview = WalkthroughAnalysis.analyze(snapshot(monorepo))
    expect(overview.topLevel).toEqual([
      { path: "docs", files: 1 },
      { path: "examples", files: 1 },
      { path: "packages", files: 5 },
    ])
    expect(overview.docs).toEqual(["README.md", "AGENTS.md"])
  })

  test("treats a repo without workspaces as a single package", () => {
    const overview = WalkthroughAnalysis.analyze(
      snapshot({
        "package.json": json({ name: "solo", main: "index.js" }),
        "src/main.ts": "",
        "nested/package.json": json({ name: "ignored" }),
      }),
    )
    expect(overview.packages).toEqual([
      { name: "solo", path: ".", entryPoints: ["main: index.js", "src: src/main.ts"], dependsOn: [] },
    ])
  })

  test("skips malformed manifests and returns no packages without a root manifest", () => {
    const broken = WalkthroughAnalysis.analyze(snapshot({ ...monorepo, "packages/web/package.json": "{ not json" }))
    expect(broken.packages.map((pkg) => pkg.name)).toEqual(["@acme/api", "@acme/core"])
    expect(WalkthroughAnalysis.analyze(snapshot({ "src/a.ts": "" })).packages).toEqual([])
  })
})

describe("WalkthroughAnalysis.wanted", () => {
  test("requests manifests and adjacent READMEs, not node_modules", () => {
    const wanted = WalkthroughAnalysis.wanted(Object.keys(monorepo))
    expect(wanted).toContain("package.json")
    expect(wanted).toContain("packages/web/README.md")
    expect(wanted).not.toContain("node_modules/left-pad/package.json")
    expect(wanted).not.toContain("docs/guide.md")
  })
})

describe("WalkthroughAnalysis.render without packages", () => {
  const render = (tree: Record<string, string>) =>
    WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(snapshot(tree)))

  test("says so when there is no package.json, and still lists directories and docs", () => {
    const text = render({ "README.md": "# hi", "src/main.go": "", "src/util.go": "" })
    expect(text).toContain("No packages detected from package.json files")
    expect(text).toContain("Docs: README.md")
    expect(text).toContain("- src/ (2 files)")
    expect(text).not.toContain("## Packages")
  })

  test("says so for nested manifests without a root manifest", () => {
    const text = render({ "packages/a/package.json": json({ name: "a" }), "src/x.ts": "" })
    expect(text).toContain("No packages detected")
  })

  test("does not crash on an empty repository", () => {
    expect(render({})).toBe(
      "# Repository\n\nNo packages detected from package.json files; showing directory layout only.",
    )
  })

  test("omits the note when packages are found", () => {
    expect(render(monorepo)).not.toContain("No packages detected")
  })
})

describe("WalkthroughAnalysis.render", () => {
  test("outlines packages, dependencies and directories", () => {
    const text = WalkthroughAnalysis.render(WalkthroughAnalysis.analyze(snapshot(monorepo)))
    expect(text).toContain("# acme")
    expect(text).toContain("- @acme/core (packages/core) - Core engine")
    expect(text).toContain("depends on: @acme/api, @acme/core")
    expect(text).toContain("- packages/ (5 files)")
  })
})
