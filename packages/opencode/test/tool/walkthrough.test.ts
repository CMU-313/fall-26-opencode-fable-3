import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import { WalkthroughTool } from "../../src/tool/walkthrough"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Git } from "@/git"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import type * as Tool from "../../src/tool/tool"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
  ),
)

type Ask = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

const context = (ask: (req: Ask) => Effect.Effect<void> = () => Effect.void) =>
  ({
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask,
  }) satisfies Tool.Context

const write = (directory: string, files: Record<string, string>) =>
  Effect.promise(() =>
    Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(directory, file), text))),
  )

const run = (ctx: Tool.Context) =>
  Effect.gen(function* () {
    const info = yield* WalkthroughTool
    const tool = yield* info.init()
    return yield* tool.execute({}, ctx)
  })

describe("tool.walkthrough", () => {
  it.instance("summarizes packages, entry points and dependencies of the instance directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(test.directory, {
        "package.json": JSON.stringify({ name: "acme", workspaces: ["packages/*"] }),
        "README.md": "# Acme",
        "packages/api/package.json": JSON.stringify({
          name: "@acme/api",
          bin: { acme: "./bin/acme" },
          dependencies: { "@acme/core": "*", zod: "1.0.0" },
        }),
        "packages/api/README.md": "# API\n\nHTTP surface.",
        "packages/api/src/index.ts": "export {}",
        "packages/core/package.json": JSON.stringify({ name: "@acme/core", description: "Core engine" }),
        "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad" }),
      })

      const result = yield* run(context())

      expect(result.title).toBe("Repository walkthrough")
      expect(result.output).toContain("# acme")
      expect(result.output).toContain("Docs: README.md")
      expect(result.output).toContain("- @acme/api (packages/api) - HTTP surface.")
      expect(result.output).toContain("entry: bin: acme -> ./bin/acme; src: src/index.ts")
      expect(result.output).toContain("depends on: @acme/core")
      expect(result.output).toContain("- @acme/core (packages/core) - Core engine")
      expect(result.output).not.toContain("left-pad")
      expect(result.output).not.toContain("zod")
    }),
  )

  it.instance("asks for the walkthrough permission with a wildcard pattern", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(test.directory, { "package.json": JSON.stringify({ name: "solo" }) })
      const asks: Ask[] = []

      yield* run(context((req) => Effect.sync(() => void asks.push(req))))

      expect(asks).toEqual([{ permission: "walkthrough", patterns: ["*"], always: ["*"], metadata: {} }])
    }),
  )

  it.instance("falls back to a directory overview when there is no package.json", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(test.directory, {
        "README.md": "# hi",
        "src/main.go": "package main",
        "src/util.go": "package main",
      })

      const result = yield* run(context())

      expect(result.output).toContain("No packages detected from package.json files")
      expect(result.output).toContain("Docs: README.md")
      expect(result.output).toContain("- src/ (2 files)")
      expect(result.output).not.toContain("## Packages")
    }),
  )

  it.instance("fails when permission is denied", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(test.directory, { "package.json": JSON.stringify({ name: "solo" }) })

      const exit = yield* run(context(() => Effect.die(new Error("denied")))).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
