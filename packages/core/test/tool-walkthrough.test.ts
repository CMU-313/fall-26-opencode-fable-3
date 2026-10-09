import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WalkthroughTool } from "@opencode-ai/core/tool/walkthrough"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location, tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_walkthrough_tool_test")
const tree: Record<string, string> = {
  "package.json": JSON.stringify({ name: "acme", workspaces: ["packages/*"] }),
  "packages/api/package.json": JSON.stringify({
    name: "@acme/api",
    bin: { acme: "./bin/acme" },
    dependencies: { "@acme/core": "*" },
  }),
  "packages/api/README.md": "# API\n\nHTTP surface.",
  "packages/api/src/index.ts": "export {}",
  "packages/core/package.json": JSON.stringify({ name: "@acme/core", description: "Core engine" }),
}

const assertions: PermissionV2.AssertInput[] = []
const reads: string[] = []
const globs: Ripgrep.GlobInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: ({ path }) => {
      reads.push(path)
      return Effect.succeed({ content: new TextEncoder().encode(tree[path]), mime: "text/plain" })
    },
    glob: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    find: () => Effect.die("unused"),
    grep: () => Effect.die("unused"),
  }),
)
const ripgrep = Layer.succeed(
  Ripgrep.Service,
  Ripgrep.Service.of({
    glob: (input) =>
      Effect.sync(() => {
        globs.push(input)
        return Object.keys(tree).map((file) => FileSystem.Entry.make({ path: RelativePath.make(file), type: "file" }))
      }),
    find: () => Effect.die("unused"),
    grep: () => Effect.die("unused"),
  }),
)
const projectLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, WalkthroughTool.node]), [
    [PermissionV2.node, permission],
    [FileSystem.node, filesystem],
    [Ripgrep.node, ripgrep],
    [Location.node, projectLocation],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)
const live = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Location.node, ToolRegistry.node, ToolRegistry.toolsNode, WalkthroughTool.node]),
    [
      [PermissionV2.node, permission],
      [Location.node, tempLocationLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const call = {
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-walkthrough", name: WalkthroughTool.name, input: {} },
}

const reset = () => {
  assertions.length = 0
  reads.length = 0
  globs.length = 0
  deny = false
}

describe("WalkthroughTool", () => {
  it.effect("registers, asserts the wildcard resource, and returns packages with an outline", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([WalkthroughTool.name])
      const settled = yield* settleTool(registry, call)
      expect(settled.output).toMatchObject({
        structured: {
          name: "acme",
          packages: [
            { name: "@acme/api", path: "packages/api", description: "HTTP surface.", dependsOn: ["@acme/core"] },
            { name: "@acme/core", path: "packages/core", description: "Core engine", dependsOn: [] },
          ],
        },
      })
      expect(settled.result).toMatchObject({ type: "text" })
      expect(String(settled.result.value)).toContain("- @acme/api (packages/api) - HTTP surface.")
      expect(String(settled.result.value)).toContain("depends on: @acme/core")
      expect(assertions).toMatchObject([{ sessionID, action: "walkthrough", resources: ["*"], save: ["*"] }])
      expect(globs).toEqual([{ cwd: "/project", pattern: "**/*", limit: expect.any(Number) }])
    }),
  )

  it.effect("reads only manifests and adjacent READMEs", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      yield* executeTool(registry, call)
      expect(reads.sort()).toEqual([
        "package.json",
        "packages/api/README.md",
        "packages/api/package.json",
        "packages/core/package.json",
      ])
    }),
  )

  it.effect("fails without touching the filesystem when permission is denied", () =>
    Effect.gen(function* () {
      reset()
      deny = true
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call)).toEqual({
        type: "error",
        value: "Unable to build a repository walkthrough",
      })
      expect(globs).toEqual([])
      expect(reads).toEqual([])
    }),
  )

  live.live("analyzes a real fixture repository on disk", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const root = (yield* Location.Service).directory
      yield* Effect.promise(async () => {
        for (const [file, text] of Object.entries({
          ...tree,
          "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad" }),
        })) {
          await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
          await fs.writeFile(path.join(root, file), text)
        }
      })

      const settled = yield* settleTool(registry, call)
      expect(settled.output).toMatchObject({
        structured: {
          name: "acme",
          packages: [
            {
              name: "@acme/api",
              entryPoints: ["bin: acme -> ./bin/acme", "src: src/index.ts"],
              dependsOn: ["@acme/core"],
            },
            { name: "@acme/core", dependsOn: [] },
          ],
          topLevel: [{ path: "packages", files: 4 }],
        },
      })
    }),
  )
})
