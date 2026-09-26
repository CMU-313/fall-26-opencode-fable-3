export * as WalkthroughAnalysis from "./walkthrough-analysis"

import { Schema } from "effect"

export const Package = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  entryPoints: Schema.Array(Schema.String),
  dependsOn: Schema.Array(Schema.String),
})

export const Overview = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  packages: Schema.Array(Package),
  topLevel: Schema.Array(Schema.Struct({ path: Schema.String, files: Schema.Number })),
  docs: Schema.Array(Schema.String),
})
export type Overview = typeof Overview.Type

export interface Snapshot {
  /** Repo-relative file paths with "/" separators. */
  readonly files: readonly string[]
  /** Text of the files returned by `wanted`; unreadable files are simply absent. */
  readonly contents: Readonly<Record<string, string>>
}

type Json = Record<string, unknown>

const MANIFEST = "package.json"
const DOCS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "ARCHITECTURE.md"]
const SUMMARY_DOCS = ["README.md", "AGENTS.md"]
const ENTRY_BASES = ["src/index", "src/main"]
const ENTRY_EXTENSIONS = ["ts", "tsx", "js", "jsx"]
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const MAX_EXPORTS = 5
const MAX_DESCRIPTION = 200

const inNodeModules = (file: string) => file.split("/").includes("node_modules")
const isManifest = (file: string) => file === MANIFEST || file.endsWith(`/${MANIFEST}`)
const dirname = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "")
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

const str = (value: unknown) => (typeof value === "string" ? value : undefined)
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {}
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const parse = (text: string | undefined) => {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

/** Supports literal segments and single-segment `*`, which covers common workspace globs. */
const workspaceMatcher = (glob: string) =>
  new RegExp(
    "^" +
      glob
        .split("/")
        .map((segment) =>
          segment === "*" ? "[^/]+" : segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        )
        .join("/") +
      "$",
  )

const packageDirs = (files: readonly string[], root: Json | undefined) => {
  if (!root) return []
  const workspaces = Array.isArray(root.workspaces) ? root.workspaces : obj(root.workspaces).packages
  const matchers = strings(workspaces)
    .filter((glob) => !glob.startsWith("!"))
    .map(workspaceMatcher)
  if (matchers.length === 0) return [""]
  return files
    .filter(isManifest)
    .map(dirname)
    .filter((dir) => dir !== "" && matchers.some((matcher) => matcher.test(dir)))
}

const excerpt = (text: string | undefined) => {
  const paragraph = text
    ?.split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !/^[#<>|`\-*[!]/.test(block))
  if (!paragraph) return undefined
  const line = paragraph.replace(/\s+/g, " ")
  return line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION - 1)}…` : line
}

const entryPoints = (name: string, dir: string, manifest: Json, files: ReadonlySet<string>) => {
  const entries: string[] = []
  const bin = manifest.bin
  if (typeof bin === "string") entries.push(`bin: ${name} -> ${bin}`)
  else for (const [command, target] of Object.entries(obj(bin))) entries.push(`bin: ${command} -> ${String(target)}`)
  const main = str(manifest.main)
  if (main) entries.push(`main: ${main}`)
  const module = str(manifest.module)
  if (module) entries.push(`module: ${module}`)
  const exported = str(manifest.exports)
  if (exported) entries.push(`exports: ${exported}`)
  const subpaths = Object.keys(obj(manifest.exports)).filter((key) => key.startsWith("."))
  if (subpaths.length > 0) {
    const more = subpaths.length - MAX_EXPORTS
    entries.push(`exports: ${subpaths.slice(0, MAX_EXPORTS).join(", ")}${more > 0 ? ` (+${more} more)` : ""}`)
  }
  for (const base of ENTRY_BASES) {
    const found = ENTRY_EXTENSIONS.map((extension) => `${base}.${extension}`).find((file) => files.has(join(dir, file)))
    if (found) entries.push(`src: ${found}`)
  }
  return entries
}

/** Files `analyze` needs read: every manifest plus the README/AGENTS next to it. */
export const wanted = (files: readonly string[]) => {
  const present = new Set(files)
  return files
    .filter((file) => isManifest(file) && !inNodeModules(file))
    .flatMap((manifest) => [
      manifest,
      ...SUMMARY_DOCS.map((doc) => join(dirname(manifest), doc)).filter((doc) => present.has(doc)),
    ])
}

export const analyze = (snapshot: Snapshot): Overview => {
  const { contents } = snapshot
  const files = snapshot.files.filter((file) => !inNodeModules(file))
  const present = new Set(files)
  const root = parse(contents[MANIFEST])

  const loaded = packageDirs(files, root).flatMap((dir) => {
    const manifest = parse(contents[join(dir, MANIFEST)])
    return manifest ? [{ dir, manifest, name: str(manifest.name) ?? (dir || ".") }] : []
  })
  const names = new Set(loaded.map((pkg) => pkg.name))

  const packages = loaded
    .map(({ dir, manifest, name }) => {
      const description =
        str(manifest.description) ?? SUMMARY_DOCS.map((doc) => excerpt(contents[join(dir, doc)])).find(Boolean)
      const dependencies = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(obj(manifest[field])))
      return {
        name,
        path: dir || ".",
        ...(description ? { description } : {}),
        entryPoints: entryPoints(name, dir, manifest, present),
        dependsOn: [...new Set(dependencies)].filter((dep) => dep !== name && names.has(dep)).sort(),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))

  const counts = new Map<string, number>()
  for (const file of files) {
    const slash = file.indexOf("/")
    if (slash > 0) counts.set(file.slice(0, slash), (counts.get(file.slice(0, slash)) ?? 0) + 1)
  }

  const name = str(root?.name)
  return {
    ...(name ? { name } : {}),
    packages,
    topLevel: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([path, count]) => ({ path, files: count })),
    docs: DOCS.filter((doc) => present.has(doc)),
  }
}

/** Compact outline for the model; it turns these facts into the narrative walkthrough. */
export const render = (overview: Overview) => {
  const lines = [`# ${overview.name ?? "Repository"}`]
  if (overview.docs.length > 0) lines.push(`Docs: ${overview.docs.join(", ")}`)
  if (overview.packages.length > 0) {
    lines.push("", "## Packages")
    for (const pkg of overview.packages) {
      lines.push(`- ${pkg.name} (${pkg.path})${pkg.description ? ` - ${pkg.description}` : ""}`)
      if (pkg.entryPoints.length > 0) lines.push(`  entry: ${pkg.entryPoints.join("; ")}`)
      if (pkg.dependsOn.length > 0) lines.push(`  depends on: ${pkg.dependsOn.join(", ")}`)
    }
  }
  if (overview.topLevel.length > 0) {
    lines.push("", "## Top-level directories")
    for (const entry of overview.topLevel) lines.push(`- ${entry.path}/ (${entry.files} files)`)
  }
  return lines.join("\n")
}
